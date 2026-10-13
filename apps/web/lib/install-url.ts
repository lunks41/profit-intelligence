/**
 * The store name behind whatever a merchant types: "my-shop", "my-shop.myshopify.com", "https://my-shop.myshopify.com/admin"
 * or "admin.shopify.com/store/my-shop". Null when it cannot be a Shopify store name.
 */
export function storeHandle(input: string): string | null {
  let v = input.trim().toLowerCase();
  if (!v) return null;
  const adminStore = /admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/.exec(v);
  if (adminStore) return adminStore[1]!;
  v = v.replace(/^https?:\/\//, '').split(/[/?#]/)[0]!;
  v = v.replace(/\.myshopify\.com$/, '');
  return /^[a-z0-9][a-z0-9-]{0,60}$/.test(v) ? v : null;
}

/**
 * The address that installs the app on a store. The app uses Shopify's managed installation, so Shopify itself shows
 * the permission screen; this app only sends the merchant there. Null when the store name or the app key is not usable.
 */
export function installUrl(store: string, clientId: string | undefined): string | null {
  const handle = storeHandle(store);
  if (!handle || !clientId || !/^[a-f0-9]{16,64}$/i.test(clientId)) return null;
  return `https://admin.shopify.com/store/${handle}/oauth/install?client_id=${clientId}`;
}
