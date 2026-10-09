import {
  configureAppUser,
  createDatabaseIfMissing,
  resetDatabase,
  runMigrations,
} from '../src/admin.js';
import { ADMIN_URL, APP_PASSWORD } from './urls.js';

// Builds the test database from scratch (empty database -> all migrations) before each run.
export default async function setup() {
  if (!/_test$/.test(new URL(ADMIN_URL).pathname.slice(1))) {
    throw new Error('Refusing to reset a database whose name does not end in _test');
  }
  await createDatabaseIfMissing(ADMIN_URL);
  await resetDatabase(ADMIN_URL);
  await runMigrations(ADMIN_URL);
  await configureAppUser(ADMIN_URL, APP_PASSWORD);
}
