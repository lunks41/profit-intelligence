import { defineConfig } from 'vitest/config';

// Integration tests need a PostgreSQL server (default: `pnpm db:up`, localhost:5433).
// Workspace packages are consumed from dist, so run `pnpm build` first.
export default defineConfig({
  test: {
    include: [
      'packages/**/test/**/*.integration.test.ts',
      'apps/**/src/**/*.integration.test.ts',
      'tests/**/*.integration.test.ts',
    ],
    globalSetup: ['packages/db/test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
