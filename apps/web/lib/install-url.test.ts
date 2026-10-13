import { describe, expect, it } from 'vitest';
import { installUrl, storeHandle } from './install-url';

const KEY = '3bbbd3e97c78785f41572acca98bc4d5';

describe('the store name a merchant types', () => {
  it('takes a plain name, the myshopify address, a pasted link or the admin address', () => {
    for (const v of [
      'my-shop',
      'My-Shop',
      'my-shop.myshopify.com',
      'https://my-shop.myshopify.com/admin',
      'https://admin.shopify.com/store/my-shop/apps',
      '  my-shop  ',
    ]) {
      expect(storeHandle(v)).toBe('my-shop');
    }
  });

  it('refuses anything that cannot be a store name', () => {
    for (const v of [
      '',
      '   ',
      'my shop',
      'evil.example.com',
      '../x',
      'a'.repeat(80),
      '-shop',
      'shop@x',
    ]) {
      expect(storeHandle(v)).toBeNull();
    }
  });
});

describe('the install address', () => {
  it('goes to Shopify with the app key and nothing else', () => {
    expect(installUrl('my-shop.myshopify.com', KEY)).toBe(
      `https://admin.shopify.com/store/my-shop/oauth/install?client_id=${KEY}`,
    );
  });

  it('is null without a usable store or app key, and never leaves Shopify', () => {
    expect(installUrl('', KEY)).toBeNull();
    expect(installUrl('my-shop', undefined)).toBeNull();
    expect(installUrl('my-shop', 'not a key')).toBeNull();
    expect(installUrl('evil.example.com/x', KEY)).toBeNull();
    expect(installUrl('my-shop', KEY)!.startsWith('https://admin.shopify.com/store/')).toBe(true);
  });
});
