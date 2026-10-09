import { Global, Module } from '@nestjs/common';
import { createShopifyAdmin, createShopifyAuth, createTokenCrypto } from '@pi/shopify';
import type { AppEnv } from '../config/config.module.js';
import { APP_ENV, SHOPIFY_ADMIN, SHOPIFY_AUTH, TOKEN_CRYPTO } from '../tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: SHOPIFY_AUTH,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) =>
        createShopifyAuth({
          apiKey: env.SHOPIFY_API_KEY,
          apiSecret: env.SHOPIFY_API_SECRET,
          scopes: env.SHOPIFY_SCOPES.split(',').map((s) => s.trim()),
        }),
    },
    {
      provide: SHOPIFY_ADMIN,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => createShopifyAdmin(env.SHOPIFY_API_VERSION),
    },
    {
      provide: TOKEN_CRYPTO,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) =>
        createTokenCrypto(
          { [env.TOKEN_ENCRYPTION_KEY_ID]: env.TOKEN_ENCRYPTION_KEY },
          env.TOKEN_ENCRYPTION_KEY_ID,
        ),
    },
  ],
  exports: [SHOPIFY_AUTH, SHOPIFY_ADMIN, TOKEN_CRYPTO],
})
export class ShopifyModule {}
