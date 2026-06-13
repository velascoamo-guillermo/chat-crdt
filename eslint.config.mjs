import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import expoFlat from 'eslint-config-expo/flat.js';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.cjs',
    ],
  },

  // Base JS + TypeScript recommended (no type-checking — fast, no project graph needed)
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Expo / React Native rules scoped to the mobile app only
  ...expoFlat.map((config) => ({
    ...config,
    files: ['apps/mobile/**/*.{js,jsx,ts,tsx}'],
  })),

  // Project-wide rule tuning — keep stylistic noise as warnings so CI fails only on real errors
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Tests may use looser typing
  {
    files: ['**/*.{test,spec}.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
