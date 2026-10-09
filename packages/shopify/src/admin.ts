export interface ShopInfo {
  name: string;
  currencyCode: string;
  ianaTimezone: string;
}

export interface ShopifyAdmin {
  fetchShopInfo(shopDomain: string, accessToken: string): Promise<ShopInfo>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const SHOP_QUERY = '{ shop { name currencyCode ianaTimezone } }';

export function createShopifyAdmin(apiVersion: string, fetchImpl: FetchLike = fetch): ShopifyAdmin {
  return {
    async fetchShopInfo(shopDomain, accessToken) {
      const res = await fetchImpl(`https://${shopDomain}/admin/api/${apiVersion}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query: SHOP_QUERY }),
      });
      if (!res.ok) throw new Error(`Shopify Admin API request failed with status ${res.status}`);
      const body = (await res.json()) as {
        data?: { shop?: Partial<ShopInfo> };
        errors?: unknown;
      };
      const shop = body.data?.shop;
      if (!shop?.name || !shop.currencyCode || !shop.ianaTimezone) {
        throw new Error('Shopify Admin API returned an unexpected shop payload');
      }
      return { name: shop.name, currencyCode: shop.currencyCode, ianaTimezone: shop.ianaTimezone };
    },
  };
}
