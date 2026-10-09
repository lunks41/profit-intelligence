// Rate-limit-aware Shopify Admin GraphQL client for background sync.
// Errors never include the access token or response bodies.

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ShopifyApiError';
  }
}

/** The access token was revoked or lacks a scope: retrying will not help. */
export class ShopifyAccessError extends ShopifyApiError {
  constructor(status: number) {
    super(`Shopify rejected the access token (status ${status})`, status);
    this.name = 'ShopifyAccessError';
  }
}

// Any is intentional: GraphQL JSON is validated by the mappers, not here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface ShopifyGraphql {
  query(query: string, variables?: Record<string, unknown>): Promise<Json>;
}

export interface GraphqlClientOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createShopifyGraphql(opts: GraphqlClientOptions): ShopifyGraphql {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = opts.maxAttempts ?? 8;
  const url = `https://${opts.shopDomain}/admin/api/${opts.apiVersion}/graphql.json`;

  return {
    async query(query, variables = {}) {
      for (let attempt = 1; ; attempt++) {
        let res: Response;
        try {
          res = await doFetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-shopify-access-token': opts.accessToken,
            },
            body: JSON.stringify({ query, variables }),
          });
        } catch {
          if (attempt >= maxAttempts) throw new ShopifyApiError('Network error calling Shopify');
          await sleep(Math.min(30_000, 500 * 2 ** attempt));
          continue;
        }

        if (res.status === 401 || res.status === 403) throw new ShopifyAccessError(res.status);
        if (res.status === 429 || res.status >= 500) {
          if (attempt >= maxAttempts) {
            throw new ShopifyApiError(`Shopify request failed (status ${res.status})`, res.status);
          }
          const retryAfter = Number(res.headers.get('retry-after'));
          await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 500 * 2 ** attempt));
          continue;
        }

        const body = (await res.json()) as Json;
        const errors: Json[] = body.errors ?? [];
        if (errors.some((e) => e.extensions?.code === 'THROTTLED')) {
          if (attempt >= maxAttempts) throw new ShopifyApiError('Shopify throttled the request');
          const t = body.extensions?.cost?.throttleStatus;
          const need =
            (body.extensions?.cost?.requestedQueryCost ?? 100) - (t?.currentlyAvailable ?? 0);
          const wait = t?.restoreRate ? Math.ceil((need / t.restoreRate) * 1000) : 2000;
          await sleep(Math.min(30_000, Math.max(1000, wait)));
          continue;
        }
        if (errors.length) {
          const text = errors.map((e) => String(e.message ?? 'error')).join('; ');
          throw new ShopifyApiError(`GraphQL error: ${text.slice(0, 300)}`);
        }
        // Pace ourselves when the bucket is nearly empty rather than waiting for a throttle.
        const t = body.extensions?.cost?.throttleStatus;
        if (t && t.currentlyAvailable < 250 && t.restoreRate) {
          await sleep(Math.ceil(((250 - t.currentlyAvailable) / t.restoreRate) * 1000));
        }
        return body.data;
      }
    },
  };
}
