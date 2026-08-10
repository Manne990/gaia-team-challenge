import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/{unit,integration}/**/*.test.ts"],
    passWithNoTests: false,
    sequence: { concurrent: true },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["tests/fixtures/**/*.ts", "tests/support/**/*.ts"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
