import {
  configureAppUser,
  createDatabaseIfMissing,
  databaseName,
  resetDatabase,
  runMigrations,
} from './admin.js';
import { seedDevelopmentData } from './seed.js';

// Usage: tsx src/cli.ts <create|migrate|roles|seed|reset|setup> [--yes]
// Reads DATABASE_ADMIN_URL (owner / migrator) and APP_DB_PASSWORD from the environment.

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const command = process.argv[2];
const adminUrl = need('DATABASE_ADMIN_URL');

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  switch (command) {
    case 'create':
      console.log(
        (await createDatabaseIfMissing(adminUrl))
          ? `created database ${databaseName(adminUrl)}`
          : `database ${databaseName(adminUrl)} already exists`,
      );
      break;
    case 'migrate':
      await runMigrations(adminUrl);
      console.log('migrations applied');
      break;
    case 'roles':
      await configureAppUser(adminUrl, need('APP_DB_PASSWORD'));
      console.log('app_user login configured');
      break;
    case 'seed':
      if (isProd) throw new Error('Refusing to seed when NODE_ENV=production');
      await seedDevelopmentData(adminUrl);
      console.log('development seed applied');
      break;
    case 'setup':
      await createDatabaseIfMissing(adminUrl);
      await runMigrations(adminUrl);
      await configureAppUser(adminUrl, need('APP_DB_PASSWORD'));
      console.log(`database ${databaseName(adminUrl)} ready`);
      break;
    case 'reset':
      if (isProd) throw new Error('Refusing to reset when NODE_ENV=production');
      if (!process.argv.includes('--yes')) {
        throw new Error(
          `reset DROPS all data in ${databaseName(adminUrl)}. Re-run with --yes to confirm.`,
        );
      }
      await resetDatabase(adminUrl);
      await runMigrations(adminUrl);
      await configureAppUser(adminUrl, need('APP_DB_PASSWORD'));
      console.log(`database ${databaseName(adminUrl)} reset`);
      break;
    default:
      throw new Error('Usage: cli <create|migrate|roles|seed|reset|setup> [--yes]');
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
