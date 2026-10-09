import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module
import config from '../apps/web/next.config.mjs';

type Header = { key: string; value: string };
const headers = async (): Promise<Header[]> => (await config.headers())[0].headers;

describe('web app headers', () => {
  it('only Shopify Admin may embed the app in a frame', async () => {
    const csp = (await headers()).find((h) => h.key === 'Content-Security-Policy')!;
    expect(csp.value).toBe('frame-ancestors https://admin.shopify.com https://*.myshopify.com');
  });

  it('stops type sniffing and limits what is sent to other sites and which browser features can be used', async () => {
    const h = Object.fromEntries((await headers()).map((x) => [x.key, x.value]));
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toContain('camera=()');
  });

  it('does not announce the framework and proxies the API from the same address', () => {
    expect(config.poweredByHeader).toBe(false);
    return config
      .rewrites()
      .then((r: Array<{ source: string }>) => expect(r[0]!.source).toBe('/api/v1/:path*'));
  });
});
