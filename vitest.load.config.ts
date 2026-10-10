import { defineConfig } from 'vitest/config';

// Load test (pnpm test:load): fills a TEST database with synthetic orders and times the Overview,
// the Orders list and the Products list through the real API. It never touches the dev or
// production database: the database name must end in _test and is reset on every run.
//   LOAD_ORDERS      number of synthetic orders (default 50000)
//   LOAD_DB_URL      admin URL of the load-test database (default: profit_intelligence_load_test)
//   LOAD_ASSERT=0    only report the timings, do not fail on the targets
process.env.TEST_DATABASE_ADMIN_URL =
  process.env.LOAD_DB_URL ??
  'postgresql://postgres:postgres@localhost:5433/profit_intelligence_load_test';

export default defineConfig({
  test: {
    include: ['apps/api/src/**/*.load.test.ts'],
    globalSetup: ['packages/db/test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30 * 60_000,
    hookTimeout: 30 * 60_000,
  },
});
