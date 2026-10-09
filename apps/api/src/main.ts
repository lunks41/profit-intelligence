import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { assertProductionConfig, createLogger, loadEnv, loadShopifyEnv } from '@pi/config';
import { StructuredLogger } from './common/security.js';
import { AppModule } from './app.module.js';
import { configureApp } from './setup.js';

async function bootstrap() {
  const env = loadEnv();
  // Refuse to start in production with an unsafe setup, naming every problem at once.
  assertProductionConfig({ ...env, ...loadShopifyEnv() });
  const log = createLogger('api');
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    rawBody: true, // webhook signatures are computed over the exact bytes received
    logger: new StructuredLogger(log),
  });
  configureApp(app, { production: env.NODE_ENV === 'production', log });
  await app.listen(env.API_PORT, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
