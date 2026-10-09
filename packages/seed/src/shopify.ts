import pg from 'pg';
import { createTokenCrypto } from '@pi/shopify';

// Any is intentional: this dev-only tool passes Shopify GraphQL JSON through untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface ShopifyClient {
  shopDomain: string;
  gql(query: string, variables?: Record<string, unknown>): Promise<Json>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/**
 * Connects to the dev store using the offline token the app already stored (decrypted in memory
 * only). Refuses anything that is not a Shopify partner development store.
 */
export async function connect(shopDomain: string): Promise<ShopifyClient> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
  const apiVersion = process.env.SHOPIFY_API_VERSION ?? '2026-10';

  const db = new pg.Client({ connectionString: need('DATABASE_ADMIN_URL') });
  await db.connect();
  let encrypted: string;
  try {
    const { rows } = await db.query<{ t: string }>(
      `select k.encrypted_access_token t
         from m_shop s join s_shop_credential k on k.shop_id = s.id
        where s.shopify_domain = $1 and s.status = 'active'`,
      [shopDomain],
    );
    if (!rows[0]) throw new Error(`Shop ${shopDomain} is not installed (open the app once first)`);
    encrypted = rows[0].t;
  } finally {
    await db.end();
  }
  const keyId = process.env.TOKEN_ENCRYPTION_KEY_ID ?? 'k1';
  const token = createTokenCrypto({ [keyId]: need('TOKEN_ENCRYPTION_KEY') }, keyId).decrypt(
    encrypted,
  );

  const url = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;
  const client: ShopifyClient = {
    shopDomain,
    async gql(query, variables = {}) {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
          body: JSON.stringify({ query, variables }),
        });
        if (res.status === 429 || res.status >= 500) {
          if (attempt > 8) throw new Error(`Shopify request failed with status ${res.status}`);
          await sleep(Math.min(30_000, 1000 * 2 ** attempt));
          continue;
        }
        const body = (await res.json()) as Json;
        const throttled = body.errors?.some(
          (e: Json) => e.extensions?.code === 'THROTTLED' || /throttl/i.test(e.message ?? ''),
        );
        if (throttled && attempt < 10) {
          await sleep(2000 + attempt * 1000);
          continue;
        }
        if (body.errors?.length) {
          throw new Error(`GraphQL error: ${body.errors.map((e: Json) => e.message).join('; ')}`);
        }
        // Pace ourselves when the cost bucket is nearly empty.
        const available = body.extensions?.cost?.throttleStatus?.currentlyAvailable;
        if (typeof available === 'number' && available < 200) await sleep(1500);
        return body.data;
      }
    },
  };

  const plan = await client.gql('{ shop { plan { partnerDevelopment } } }');
  if (plan.shop.plan.partnerDevelopment !== true) {
    throw new Error('Refusing to seed: this is not a Shopify partner development store');
  }
  return client;
}

export { sleep };
