import { Global, Inject, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { createDb, createPool } from '@pi/db';
import type { Db } from '@pi/db';
import type pg from 'pg';
import type { AppEnv } from '../config/config.module.js';
import { APP_ENV, DB, DB_POOL } from '../tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: DB_POOL,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => createPool(env.DATABASE_URL),
    },
    { provide: DB, inject: [DB_POOL], useFactory: (pool: pg.Pool): Db => createDb(pool) },
  ],
  exports: [DB, DB_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
