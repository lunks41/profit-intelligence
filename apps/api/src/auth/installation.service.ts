import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { installShop, resolveTenantByShopDomain } from '@pi/db';
import type { Db } from '@pi/db';
import type { ShopifyAdmin, ShopifyAuth, TokenCrypto, VerifiedSession } from '@pi/shopify';
import type { AppEnv } from '../config/config.module.js';
import { SyncService } from '../sync/sync.service.js';
import { APP_ENV, DB, SHOPIFY_ADMIN, SHOPIFY_AUTH, TOKEN_CRYPTO } from '../tokens.js';

/** Server-side identity of the caller. Derived only from a verified Shopify session token. */
export interface TenantContext {
  tenantId: string;
  shopId: string;
  shopDomain: string;
  /** Shopify staff or owner id from the session token, for the audit trail */
  userId?: string | null;
}

@Injectable()
export class InstallationService {
  private readonly logger = new Logger(InstallationService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SHOPIFY_AUTH) private readonly auth: ShopifyAuth,
    @Inject(SHOPIFY_ADMIN) private readonly admin: ShopifyAdmin,
    @Inject(TOKEN_CRYPTO) private readonly crypto: TokenCrypto,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  /**
   * Maps a verified session to a tenant. Known, active shops are resolved without calling Shopify.
   * A new (or uninstalled / re-authorising) shop triggers token exchange, then an idempotent
   * install that stores the encrypted offline token.
   */
  async ensureInstalled(session: VerifiedSession, idToken: string): Promise<TenantContext> {
    const known = await resolveTenantByShopDomain(this.db, session.shopDomain);
    if (known && known.status === 'active') {
      return { tenantId: known.tenantId, shopId: known.shopId, shopDomain: session.shopDomain };
    }

    try {
      const token = await this.auth.exchangeOfflineToken(session.shopDomain, idToken);
      const info = await this.admin.fetchShopInfo(session.shopDomain, token.accessToken);
      const encrypted = this.crypto.encrypt(token.accessToken);
      const result = await installShop(this.db, {
        shopDomain: session.shopDomain,
        name: info.name,
        currency: info.currencyCode,
        ianaTimezone: info.ianaTimezone,
        encryptedAccessToken: encrypted.value,
        keyId: encrypted.keyId,
        scopes: token.scope || this.env.SHOPIFY_SCOPES,
      });
      const context = {
        tenantId: result.tenantId,
        shopId: result.shopId,
        shopDomain: session.shopDomain,
      };
      // First connection (or a re-install): start importing history in the background.
      await this.sync.start(context, 'initial');
      return context;
    } catch (e) {
      // Log only the error class and its (already sanitised) message, never tokens.
      this.logger.error(
        `Installation failed for ${session.shopDomain}: ${e instanceof Error ? `${e.name}: ${e.message}` : 'unknown'}`,
      );
      // Deliberately generic: underlying errors may carry tokens or Shopify response bodies.
      throw new BadGatewayException({
        code: 'installation_failed',
        message: 'Could not complete the store connection. Please reload the app.',
      });
    }
  }
}
