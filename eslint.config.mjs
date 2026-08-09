import js from '@eslint/js';

export default [
  { ignores: ['node_modules/', 'dist/', 'data/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        Buffer: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
];
