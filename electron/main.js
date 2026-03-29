/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8765;
const PORT_SCAN_LIMIT = 32;
const STARTUP_TIMEOUT_MS = 20000;

let mainWindow = null;
let serverProcess = null;
let serverInfo = null;
let pendingAttachPath = parseCliArgs(process.argv).attachPath;
let isQuitting = false;
let windowLoadPromise = null;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function logMainError(context, error) {
  const detail = errorMessage(error);
  console.error(`[rheon-electron] ${context}: ${detail}`);
}

function presentMainWindow(window) {
  if (isQuitting || !window || window.isDestroyed()) {
    return;
  }
  if (process.platform === 'darwin' && typeof app.isHidden === 'function' && app.isHidden()) {
    app.show();
  }
  if (process.platform === 'darwin' && app.dock && typeof app.dock.show === 'function') {
    app.dock.show();
  }
  if (window.isMinimized()) {
    window.restore();
  }

  // macOS Spaces can retain stale window placement; briefly exposing the
  // window on all workspaces mirrors Dock "reopen" behavior and pulls it
  // into the current active desktop.
  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  window.show();
  if (!window.isFocused()) {
    window.focus();
  }
  if (typeof window.moveTop === 'function') {
    window.moveTop();
  }
  if (typeof app.focus === 'function') {
    app.focus();
  }

  if (process.platform === 'darwin') {
    setTimeout(() => {
      if (!isQuitting && !window.isDestroyed()) {
        window.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: true });
      }
    }, 120);
  }
}

function resolveExistingMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  const existingWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || null;
  if (existingWindow) {
    mainWindow = existingWindow;
  }
  return existingWindow;
}

function ensureMainWindowPresented() {
  const window = resolveExistingMainWindow();
  if (!window) {
    return false;
  }
  presentMainWindow(window);
  return true;
}

function resolveDockIconPath() {
  const candidates = [
    path.resolve(__dirname, '..', 'assets', 'rheon_regr_app.icns'),
    path.join(process.resourcesPath, 'assets', 'rheon_regr_app.icns'),
    path.join(process.resourcesPath, 'rheon_regr_app.icns'),
    path.resolve(__dirname, '..', 'assets', 'rheon_regr_app.png'),
    path.join(process.resourcesPath, 'assets', 'rheon_regr_app.png'),
    path.join(process.resourcesPath, 'rheon_regr_app.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function applyDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) {
    return;
  }
  const iconPath = resolveDockIconPath();
  if (iconPath) {
    app.dock.setIcon(iconPath);
  }
}

function parseCliArgs(argv) {
  const result = {
    attachPath: null,
  };

  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--attach' && argv[index + 1]) {
      result.attachPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith('--attach=')) {
      result.attachPath = path.resolve(value.slice('--attach='.length));
    }
  }

  return result;
}

function isRheonRoot(candidate) {
  if (!candidate) {
    return false;
  }

  return [
    ['bin', 'rheon_regr_app'],
    ['scripts', 'rheon_regr_app.py'],
    ['pyproject.toml'],
  ].every((segments) => fs.existsSync(path.join(candidate, ...segments)));
}

function resolveSourceRoot() {
  const envRoot = process.env.RHEON_ROOT;
  if (isRheonRoot(envRoot)) {
    return path.resolve(envRoot);
  }

  if (app.isPackaged) {
    const sourceRootFile = path.join(process.resourcesPath, 'source_root.txt');
    if (fs.existsSync(sourceRootFile)) {
      const recordedRoot = fs.readFileSync(sourceRootFile, 'utf8').trim();
      if (isRheonRoot(recordedRoot)) {
        return path.resolve(recordedRoot);
      }
    }
  }

  const devRoot = path.resolve(__dirname, '..');
  if (isRheonRoot(devRoot)) {
    return devRoot;
  }

  return null;
}

function augmentPathEnv(sourceRoot = null) {
  const extraPaths = [
    sourceRoot ? path.join(sourceRoot, '.venv', 'bin') : null,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.cargo', 'bin'),
  ];

  const currentPath = process.env.PATH || '';
  return [...extraPaths, currentPath].filter(Boolean).join(':');
}

function resolveServerCommand(sourceRoot) {
  const repoPython = path.join(sourceRoot, '.venv', 'bin', 'python');
  const binEntrypoint = path.join(sourceRoot, 'bin', 'rheon_regr_app');

  const env = {
    ...process.env,
    PATH: augmentPathEnv(sourceRoot),
    UV_CACHE_DIR: process.env.UV_CACHE_DIR || path.join(app.getPath('userData'), 'uv-cache'),
  };

  if (fs.existsSync(repoPython)) {
    return {
      command: repoPython,
      args: [binEntrypoint],
      env,
    };
  }

  return {
    command: binEntrypoint,
    args: [],
    env,
  };
}

function findAvailablePort(host = DEFAULT_HOST, startPort = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    let port = startPort;

    const tryNextPort = () => {
      if (port >= startPort + PORT_SCAN_LIMIT) {
        reject(new Error(`Could not find an available port starting at ${startPort}`));
        return;
      }

      const tester = net.createServer();
      tester.once('error', () => {
        port += 1;
        tryNextPort();
      });
      tester.once('listening', () => {
        const activePort = port;
        tester.close(() => resolve(activePort));
      });
      tester.listen(port, host);
    };

    tryNextPort();
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function probeServer(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      if (response.statusCode === 200) {
        resolve();
        return;
      }
      reject(new Error(`Server responded with HTTP ${response.statusCode}`));
    });
    request.setTimeout(1000, () => {
      request.destroy(new Error('Timed out waiting for the Rheon server'));
    });
    request.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await probeServer(url);
      return;
    } catch (error) {
      lastError = error;
      await wait(250);
    }
  }

  throw lastError || new Error('Timed out waiting for the Rheon server');
}

function buildServerUrl(host, port, attachPath = null) {
  const url = new URL(`http://${host}:${port}/`);
  if (attachPath) {
    url.searchParams.set('attach', attachPath);
  }
  return url.toString();
}

function createErrorHtml(message, details = '') {
  const safeMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeDetails = details.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Rheon Regr Startup Error</title>
  <style>
    body {
      margin: 0;
      padding: 32px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #10131a;
      color: #f7f9fc;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 22px;
    }
    p {
      color: #c6ceda;
      line-height: 1.5;
    }
    pre {
      margin-top: 20px;
      padding: 16px;
      border-radius: 10px;
      background: #171c25;
      color: #d9e2f2;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <h1>Rheon Regr failed to start</h1>
  <p>${safeMessage}</p>
  <pre>${safeDetails}</pre>
</body>
</html>`;
}

function createLoadingHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Rheon Regr</title>
  <style>
    body {
      margin: 0;
      background: radial-gradient(circle at 20% 20%, #12345a, #090f1d 60%);
      color: #e7f1ff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: grid;
      place-items: center;
      height: 100vh;
    }
    .card {
      padding: 20px 24px;
      border-radius: 14px;
      border: 1px solid rgba(199, 225, 255, 0.2);
      background: rgba(5, 16, 32, 0.66);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
    }
    strong { display: block; font-size: 18px; margin-bottom: 6px; }
    span { color: #bfd4ef; font-size: 13px; letter-spacing: 0.03em; }
  </style>
</head>
<body>
  <div class="card">
    <strong>Starting Rheon Regr...</strong>
    <span>Launching local regression service</span>
  </div>
</body>
</html>`;
}

function ensureMainWindow() {
  if (isQuitting) {
    return null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 960,
    minHeight: 720,
    show: false,
    backgroundColor: '#0f1117',
    title: 'Rheon Regr',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.once('ready-to-show', () => {
    presentMainWindow(mainWindow);
  });
  mainWindow.once('did-finish-load', () => {
    presentMainWindow(mainWindow);
  });

  return mainWindow;
}

async function showStartupError(message, details = '') {
  if (isQuitting) {
    return;
  }
  const window = ensureMainWindow();
  if (!window) {
    return;
  }
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createErrorHtml(message, details))}`);
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) {
    return;
  }

  serverProcess.kill('SIGTERM');
}

async function startServer(sourceRoot) {
  const host = DEFAULT_HOST;
  const port = await findAvailablePort(host, DEFAULT_PORT);
  const logPath = path.join(app.getPath('userData'), 'rheon-electron-server.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  let logClosed = false;

  const serverCommand = resolveServerCommand(sourceRoot);
  const child = spawn(
    serverCommand.command,
    [...serverCommand.args, '--host', host, '--port', String(port)],
    {
      cwd: sourceRoot,
      env: serverCommand.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const appendLog = (prefix, chunk) => {
    if (logClosed) {
      return;
    }
    logStream.write(`[${new Date().toISOString()}] ${prefix} ${chunk}`);
  };
  const closeLog = () => {
    if (logClosed) {
      return;
    }
    logClosed = true;
    logStream.end();
  };

  child.stdout.on('data', (chunk) => appendLog('stdout', chunk));
  child.stderr.on('data', (chunk) => appendLog('stderr', chunk));
  child.on('error', (error) => {
    appendLog('error', `${error instanceof Error ? error.message : String(error)}\n`);
    closeLog();
  });
  child.on('exit', (code, signal) => {
    appendLog('exit', `code=${code} signal=${signal}\n`);
    closeLog();
    if (!isQuitting && serverInfo && serverInfo.ready === false) {
      showStartupError(
        'The Rheon server exited during startup.',
        `See ${logPath} for details.`,
      );
    }
  });

  serverProcess = child;
  serverInfo = {
    host,
    port,
    logPath,
    ready: false,
    sourceRoot,
  };

  try {
    await waitForServer(`http://${host}:${port}/api/state`, STARTUP_TIMEOUT_MS);
    serverInfo.ready = true;
    return serverInfo;
  } catch (error) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
    closeLog();
    throw error;
  }
}

async function attachRegressionDirectory() {
  if (!serverInfo || isQuitting) {
    return;
  }

  const window = ensureMainWindow();
  if (!window) {
    return;
  }
  const result = await dialog.showOpenDialog(window, {
    properties: ['openDirectory'],
    title: 'Attach Regression Output Directory',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return;
  }

  pendingAttachPath = path.resolve(result.filePaths[0]);
  await window.loadURL(buildServerUrl(serverInfo.host, serverInfo.port, pendingAttachPath));
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Attach Regression...',
          click: () => {
            void attachRegressionDirectory();
          },
        },
        {
          label: 'Open In Browser',
          click: () => {
            if (serverInfo) {
              void shell.openExternal(buildServerUrl(serverInfo.host, serverInfo.port, pendingAttachPath));
            }
          },
        },
        {
          label: 'Show Server Log',
          click: () => {
            if (serverInfo) {
              void shell.openPath(serverInfo.logPath);
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'windowMenu',
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function loadAppWindow() {
  if (isQuitting) {
    return;
  }
  if (windowLoadPromise) {
    await windowLoadPromise;
    return;
  }

  windowLoadPromise = (async () => {
    const sourceRoot = resolveSourceRoot();
    const window = ensureMainWindow();
    if (!window) {
      return;
    }
    presentMainWindow(window);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createLoadingHtml())}`);
    if (isQuitting) {
      return;
    }

    if (!sourceRoot) {
      await showStartupError(
        'Could not locate the Rheon checkout to launch.',
        'Set RHEON_ROOT or rebuild the packaged app from the desired repo path.',
      );
      return;
    }

    try {
      const info = await startServer(sourceRoot);
      if (isQuitting) {
        return;
      }
      await window.loadURL(buildServerUrl(info.host, info.port, pendingAttachPath));
      presentMainWindow(window);
    } catch (error) {
      if (isQuitting) {
        return;
      }
      const details = error instanceof Error ? error.message : String(error);
      await showStartupError(
        'The desktop shell could not start the Rheon regression server.',
        `${details}\n\nExpected repo root: ${sourceRoot}\nLog: ${serverInfo ? serverInfo.logPath : 'not created'}`,
      );
    }
  })();

  try {
    await windowLoadPromise;
  } finally {
    windowLoadPromise = null;
  }
}

if (!app.requestSingleInstanceLock()) {
  isQuitting = true;
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const cli = parseCliArgs(argv);
    if (cli.attachPath) {
      pendingAttachPath = cli.attachPath;
      if (mainWindow && serverInfo) {
        void mainWindow.loadURL(buildServerUrl(serverInfo.host, serverInfo.port, pendingAttachPath));
      }
    }

    if (ensureMainWindowPresented()) {
      return;
    }
    if (app.isReady() && !isQuitting) {
      void loadAppWindow();
    }
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  stopServer();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
});

app.on('window-all-closed', () => {
  isQuitting = true;
  stopServer();
  app.quit();
});

app.on('activate', () => {
  if (ensureMainWindowPresented()) {
    return;
  }
  void loadAppWindow();
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (filePath && fs.existsSync(filePath)) {
    pendingAttachPath = path.resolve(filePath);
    if (mainWindow && serverInfo) {
      void mainWindow.loadURL(buildServerUrl(serverInfo.host, serverInfo.port, pendingAttachPath));
    }
  }
});

app.whenReady().then(async () => {
  if (isQuitting) {
    return;
  }

  try {
    await loadAppWindow();
  } catch (error) {
    logMainError('initial loadAppWindow failed', error);
    const details = errorMessage(error);
    await showStartupError(
      'The desktop shell hit an unexpected startup failure.',
      details,
    );
  }

  try {
    buildMenu();
  } catch (error) {
    logMainError('buildMenu failed', error);
  }

  try {
    applyDockIcon();
  } catch (error) {
    logMainError('applyDockIcon failed', error);
  }

  if (!ensureMainWindowPresented()) {
    void loadAppWindow();
  }

  // Startup watchdog: if app becomes active without a visible window, run the
  // same create/show flow used by Dock activation.
  [250, 900].forEach((delayMs) => {
    setTimeout(() => {
      if (isQuitting) {
        return;
      }
      if (!ensureMainWindowPresented()) {
        void loadAppWindow();
      }
    }, delayMs);
  });
});
