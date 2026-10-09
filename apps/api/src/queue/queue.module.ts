import { Global, Inject, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { startQueue } from '@pi/db';
import type { PgBoss } from 'pg-boss';
import type { AppEnv } from '../config/config.module.js';
import { APP_ENV, QUEUE } from '../tokens.js';

/** The api only enqueues jobs; the worker processes them. */
@Global()
@Module({
  providers: [
    {
      provide: QUEUE,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => startQueue(env.DATABASE_URL),
    },
  ],
  exports: [QUEUE],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(@Inject(QUEUE) private readonly boss: PgBoss) {}

  async onApplicationShutdown() {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }
}
