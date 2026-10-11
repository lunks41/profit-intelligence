/**
 * The address that opens the same page again, inside the Shopify admin, so a new browser tab shows the app with
 * its sidebar like the first one. The app only works inside the admin (it needs Shopify's session), so a bare
 * copy of this page would show nothing. Only the page and the `tab` choice are carried over; the long session
 * parameters in the address are never copied. Null when the shop or the app id is not usable.
 */
export function newTabUrl(
  shopDomain: string,
  apiKey: string | undefined,
  location: { pathname: string; search: string },
): string | null {
  const store = shopDomain.replace(/\.myshopify\.com$/, '');
  if (!apiKey || !/^[a-f0-9]{8,64}$/i.test(apiKey) || !/^[a-z0-9][a-z0-9-]*$/.test(store)) {
    return null;
  }
  const tab = new URLSearchParams(location.search).get('tab');
  const path =
    /^\/[a-z0-9/-]*$/i.test(location.pathname) && location.pathname !== '/'
      ? location.pathname.replace(/\/+$/, '')
      : '';
  const q = tab && /^[a-z_-]{1,30}$/.test(tab) ? `?tab=${tab}` : '';
  return `https://admin.shopify.com/store/${store}/apps/${apiKey}${path}${q}`;
}
