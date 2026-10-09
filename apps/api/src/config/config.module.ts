import { Global, Module } from '@nestjs/common';
import { loadEnv, loadShopifyEnv } from '@pi/config';
import type { Env, ShopifyEnv } from '@pi/config';
import { APP_ENV } from '../tokens.js';

export type AppEnv = Env & ShopifyEnv;

@Global()
@Module({
  providers: [
    { provide: APP_ENV, useFactory: (): AppEnv => ({ ...loadEnv(), ...loadShopifyEnv() }) },
  ],
  exports: [APP_ENV],
})
export class ConfigModule {}
