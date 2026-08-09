import js from "@eslint/js";

export default [
  { ignores: ["node_modules/", "playwright-report/", "test-results/"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { console: "readonly", process: "readonly", URL: "readonly", structuredClone: "readonly" },
    },
  },
];
