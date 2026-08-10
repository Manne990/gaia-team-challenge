import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: "./src/client/test/setup.ts",
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/{unit,integration}/**/*.test.ts",
    ],
    passWithNoTests: false,
    // Integration suites repeatedly migrate and seed real SQLite files. Run
    // files serially so CPU and filesystem contention cannot turn the 5s
    // behavioral timeout into a machine-dependent failure.
    fileParallelism: false,
    sequence: { concurrent: false },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["tests/fixtures/**/*.ts", "tests/support/**/*.ts"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
