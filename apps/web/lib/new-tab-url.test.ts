import { describe, expect, it } from 'vitest';
import { newTabUrl } from './new-tab-url.js';

const KEY = '3bbbd3e97c78785f41572acca98bc4d5';
const at = (pathname: string, search = '') => ({ pathname, search });

describe('opening the page in a new tab', () => {
  it('goes to the same page inside the Shopify admin', () => {
    expect(newTabUrl('shop-one.myshopify.com', KEY, at('/products'))).toBe(
      `https://admin.shopify.com/store/shop-one/apps/${KEY}/products`,
    );
  });

  it('the home page has no path', () => {
    expect(newTabUrl('shop-one.myshopify.com', KEY, at('/'))).toBe(
      `https://admin.shopify.com/store/shop-one/apps/${KEY}`,
    );
  });

  it('keeps the tab choice and nothing else from the address', () => {
    const url = newTabUrl(
      'shop-one.myshopify.com',
      KEY,
      at('/settings', '?tab=currency&id_token=SECRET&hmac=abc&session=zzz&shop=x'),
    );
    expect(url).toBe(`https://admin.shopify.com/store/shop-one/apps/${KEY}/settings?tab=currency`);
    expect(url).not.toContain('SECRET');
  });

  it('ignores a tab value that is not a plain word', () => {
    expect(newTabUrl('s.myshopify.com', KEY, at('/settings', '?tab=a%20b%3Cscript'))).toBe(
      `https://admin.shopify.com/store/s/apps/${KEY}/settings`,
    );
  });

  it('refuses a missing or odd app id, shop or path', () => {
    expect(newTabUrl('shop-one.myshopify.com', undefined, at('/'))).toBeNull();
    expect(newTabUrl('shop-one.myshopify.com', 'not a key!', at('/'))).toBeNull();
    expect(newTabUrl('evil.com/x.myshopify.com', KEY, at('/'))).toBeNull();
    // a path with odd characters falls back to the home page instead of being copied
    expect(newTabUrl('s.myshopify.com', KEY, at('/..//evil?x'))).toBe(
      `https://admin.shopify.com/store/s/apps/${KEY}`,
    );
  });
});
