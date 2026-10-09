import { defineConfig } from 'drizzle-kit';

// Used only to generate SQL migrations (no database connection needed for `generate`).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
