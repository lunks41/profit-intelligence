import '@shopify/shopify-api/adapters/node';
import { ApiVersion, RequestedTokenType, shopifyApi } from '@shopify/shopify-api';

export interface VerifiedSession {
  /** Normalised shop domain from the signed token's `dest` claim, e.g. my-shop.myshopify.com */
  shopDomain: string;
  /** Shopify staff user id (`sub` claim), when present. */
  userId: string | null;
}

export interface OfflineToken {
  accessToken: string;
  scope: string;
}

export interface ShopifyAuth {
  /** Verifies the App Bridge ID token. Throws AuthError (never echoing the token) if invalid. */
  verifySessionToken(token: string): Promise<VerifiedSession>;
  /** Exchanges a valid ID token for a non-expiring offline access token. */
  exchangeOfflineToken(shopDomain: string, idToken: string): Promise<OfflineToken>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export interface ShopifyAuthConfig {
  apiKey: string;
  apiSecret: string;
  scopes: string[];
}

/** Extracts and validates the shop domain from the `dest` and `iss` claims. */
export function shopFromClaims(claims: {
  dest?: unknown;
  iss?: unknown;
  sub?: unknown;
}): VerifiedSession {
  if (typeof claims.dest !== 'string' || typeof claims.iss !== 'string') {
    throw new AuthError('Session token is missing required claims');
  }
  let destHost: string;
  let issHost: string;
  try {
    destHost = new URL(claims.dest).hostname.toLowerCase();
    issHost = new URL(claims.iss).hostname.toLowerCase();
  } catch {
    throw new AuthError('Session token has malformed claims');
  }
  if (destHost !== issHost || !SHOP_DOMAIN_RE.test(destHost)) {
    throw new AuthError('Session token shop is invalid');
  }
  return {
    shopDomain: destHost,
    userId: typeof claims.sub === 'string' ? claims.sub : null,
  };
}

export function createShopifyAuth(config: ShopifyAuthConfig): ShopifyAuth {
  const shopify = shopifyApi({
    apiKey: config.apiKey,
    apiSecretKey: config.apiSecret,
    scopes: config.scopes,
    hostName: 'localhost',
    apiVersion: ApiVersion.October26,
    isEmbeddedApp: true,
  });

  return {
    async verifySessionToken(token) {
      try {
        // Signature (HS256 with the app secret), exp/nbf and `aud === apiKey` are checked here.
        const claims = await shopify.session.decodeSessionToken(token);
        return shopFromClaims(claims);
      } catch (e) {
        if (e instanceof AuthError) throw e;
        // The library's error text embeds the raw token, so it is deliberately discarded.
        throw new AuthError('Invalid session token');
      }
    },
    async exchangeOfflineToken(shopDomain, idToken) {
      try {
        const { session } = await shopify.auth.tokenExchange({
          shop: shopDomain,
          sessionToken: idToken,
          requestedTokenType: RequestedTokenType.OfflineAccessToken,
          expiring: false,
        });
        if (!session.accessToken) throw new Error('no access token');
        return { accessToken: session.accessToken, scope: session.scope ?? '' };
      } catch (e) {
        // Only the HTTP status and Shopify's short error code are kept; never tokens or bodies.
        const res = (e as { response?: { code?: number; body?: { error?: unknown } } }).response;
        const status = typeof res?.code === 'number' ? res.code : null;
        const reason = typeof res?.body?.error === 'string' ? res.body.error : null;
        const detail = [status !== null ? `status ${status}` : null, reason]
          .filter(Boolean)
          .join(', ');
        throw new AuthError(detail ? `Token exchange failed (${detail})` : 'Token exchange failed');
      }
    },
  };
}
