/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // react-draggable (inside react-grid-layout) reads
  // `process.env.DRAGGABLE_DEBUG` on every drag start. Vite's dep optimizer
  // only defines NODE_ENV, so in dev the bare `process` throws inside the
  // mousedown handler and dragging dies silently — the card just never moves.
  // The production build substitutes it, which is why only `npm run dev` was
  // affected.
  define: { "process.env.DRAGGABLE_DEBUG": "false" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    host: true,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.{ts,tsx}",
      "shared/**/*.test.ts",
      "server/**/*.test.ts",
    ],
  },
});
