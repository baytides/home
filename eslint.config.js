import js from '@eslint/js';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.astro/**',
      'assets/css/**',
      'assets/js/main.js',
      '**/*.ts',
      '**/*.json',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        clearInterval: 'readonly',
        setInterval: 'readonly',
        self: 'readonly',
        caches: 'readonly',
        location: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        Promise: 'readonly',
        process: 'readonly',
        alert: 'readonly',
        URLSearchParams: 'readonly',
        MutationObserver: 'readonly',
        FormData: 'readonly',
        indexedDB: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
    },
  },
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        Buffer: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        fetch: 'readonly',
      },
    },
  },
];
