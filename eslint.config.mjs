import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['.deploy/**', '**/dist/**', '**/.next/**', '**/node_modules/**', '**/next-env.d.ts', 'scripts/**'],
  },
  js.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: { URL: 'readonly', process: 'readonly' } } },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // NestJS dependency injection needs value imports for decorated constructor parameters.
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
);
