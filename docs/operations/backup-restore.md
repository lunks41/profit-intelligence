# Backup and restore

## What is backed up

The whole PostgreSQL database (business data, settings, audit log, job queue). Shopify holds the source orders, so a lost day can also be re-imported (90 days) after a restore; costs, rules, expenses, ad spend and the audit log exist only here and are the reason backups matter.

## Take a backup

```powershell
pnpm backup                       # uses DATABASE_ADMIN_URL, writes backups\pi-<time>.dump + .json
pnpm backup -- --keep 14          # keep the newest 14 (default)
```

On a machine without PostgreSQL tools use the container that runs the database: `pnpm backup -- --docker <container-name>`.

Each backup is a compressed custom-format dump (`pg_dump -Fc`), a manifest with a SHA-256 checksum, and a snapshot of table row counts, tables with forced row level security, policies and applied migrations. The script lists the archive before it finishes, so an unreadable file fails the run. The password is passed in the environment, never on the command line.

**Schedule it nightly** (Windows Task Scheduler, or cron on Linux) and copy the folder off the machine (another server or object storage). Suggested retention: 14 daily backups. Deleted shop data stays in backups until they expire; state this to merchants who ask.

## Prove it restores

```powershell
pnpm backup:verify                # restores the newest backup into a temporary database and checks it
```

It first checks the file against its checksum, restores into `pi_restore_<time>` on the same server, compares every table and row count, the tables with forced row level security, the policy count and the migration count with the manifest, and **always drops the temporary database**. Exit code 0 only when everything matches. Run it **after each backup if you can, and at least monthly**: a backup that has never been restored is a hope.

## Restore for real (disaster recovery)

1. Stop the API and worker.
2. Create an empty database and a login role as in `docs/development` (`pnpm db:setup` creates the database, the `app_user` role and the queue schema).
3. `pg_restore --no-owner -d <database> backups\pi-<time>.dump`.
4. Run `pnpm db:migrate` (a no-op if the backup is current; applies newer migrations if it is older).
5. `pnpm db:roles` to set the `app_user` password.
6. Start the worker and API. Press Re-sync on a shop (or wait for the nightly reconcile) to pull orders newer than the backup.
7. Run `pnpm profit:verify` against a shop to confirm the ledger matches Shopify.

## Migrations: forward only

Migrations are never edited after release and have no "down" script. The recovery from a bad migration is: restore the backup taken just before it, fix the migration, run it again. Therefore:

1. **Take a backup immediately before every production migration** (`pnpm backup` then `pnpm db:migrate`).
2. Prefer additive changes (new tables, new nullable columns, new indexes). A migration that drops or rewrites data must carry `-- destructive: approved <reason>`; a test fails otherwise.
3. Test new migrations on a restored copy first.
