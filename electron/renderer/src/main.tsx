/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("Renderer root element was not found.");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
