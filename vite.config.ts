import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { readApiUrl, readUiUrl } from "./src/config.js";

const apiUrl = readApiUrl(process.env);
const uiUrl = readUiUrl(process.env);

export default defineConfig({
  plugins: [react()],
  server: {
    host: uiUrl.hostname,
    port: uiUrl.port,
    proxy: {
      "/api": {
        target: apiUrl.origin,
        ws: true
      }
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
