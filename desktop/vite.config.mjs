import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  base: "./",
  root: ".",
  server: { fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
