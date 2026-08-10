import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  server: { hmr: process.env.NORTHSTAR_TEST_MODE === "1" ? false : undefined },
  build: { outDir: "../../dist/client", emptyOutDir: true },
  test: {
    root: process.cwd(),
    environment: "jsdom",
    setupFiles: "./src/client/test/setup.ts",
    exclude: ["dist/**", "node_modules/**"],
  },
});
