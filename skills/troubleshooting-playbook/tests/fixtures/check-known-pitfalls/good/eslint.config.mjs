// eslint.config.mjs
import jest from 'eslint-plugin-jest';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: { complexity: ['error', { max: 10, variant: 'modified' }] },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    extends: [jest.configs['flat/recommended'], jest.configs['flat/style']],
  },
]);
