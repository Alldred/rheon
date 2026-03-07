/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('rheonDesktop', {
  isElectron: true,
});
