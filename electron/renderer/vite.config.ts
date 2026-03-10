/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8765";

  return {
    root: __dirname,
    plugins: [react()],
    publicDir: false,
    server: {
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: path.resolve(__dirname, "../../scripts/rheon_regr_app_assets"),
      emptyOutDir: true,
      assetsDir: "assets",
    },
    test: {
      environment: "jsdom",
      setupFiles: path.resolve(__dirname, "src/test/setup.ts"),
      globals: true,
    },
  };
});
