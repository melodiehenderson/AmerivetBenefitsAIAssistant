// ESLint flat config — lints both JS and TS/TSX files.
// Uses typescript-eslint for type-aware rules on TS files.
import tseslint from 'typescript-eslint';

export default [
  // Global settings
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'out/**',
      'coverage/**',
      'scripts/**',
      'tests/**',
      '_ingest_stage/**',
      'interview/**',
    ],
  },
  // JS files — minimal rules
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {},
  },
  // TS/TSX files — typescript-eslint recommended (non-type-checked for speed)
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  // Override TS rules to be lenient — avoid breaking build on existing code
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Downgrade to warnings for existing code that uses these patterns
      '@typescript-eslint/no-explicit-any': 'off', // Too many existing `any` casts
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'off', // We use @ts-nocheck on dead code files
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'prefer-const': 'warn',
    },
  },
];
