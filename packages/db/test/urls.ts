// Test database: a dedicated database on the local Docker Compose server (never the shared dev DB).
export const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ??
  'postgresql://postgres:postgres@localhost:5433/profit_intelligence_test';

export const APP_PASSWORD = 'app_user_test_only';

export const APP_URL = (() => {
  const u = new URL(ADMIN_URL);
  u.username = 'app_user';
  u.password = APP_PASSWORD;
  return u.toString();
})();
