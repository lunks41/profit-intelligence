import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const toml = readFileSync(new URL('../shopify.app.toml', import.meta.url), 'utf8');
const lines = toml.split(/\r?\n/).filter((l) => !l.trim().startsWith('#'));
const value = (key: string) =>
  lines.map((l) => new RegExp(String.raw`^${key}\s*=\s*(.+)$`).exec(l)?.[1]).find(Boolean);

describe('Shopify app configuration', () => {
  it('asks only for read access to orders, products and inventory', () => {
    const scopes = (value('scopes') ?? '').replace(/["\s]/g, '').split(',').filter(Boolean).sort();
    expect(scopes).toEqual([
      'read_inventory',
      'read_orders',
      'read_products',
      'read_shopify_payments_accounts',
      'read_shopify_payments_payouts',
    ]);
    // no write scope, and no access to customers (we store no customer personal data)
    expect(scopes.filter((s) => s.startsWith('write_'))).toEqual([]);
    expect(scopes.some((s) => /customer/.test(s))).toBe(false);
    // older than 60 days needs Shopify approval; the app keeps 90 days so it must not claim more
    expect(scopes).not.toContain('read_all_orders');
  });

  it('is an embedded app that uses the current token exchange install flow', () => {
    expect(value('embedded')).toBe('true');
    expect(value('use_legacy_install_flow')).toBe('false');
  });

  it('subscribes to the three mandatory privacy topics, uninstall and subscription changes', () => {
    for (const topic of ['customers/data_request', 'customers/redact', 'shop/redact']) {
      expect(toml, topic).toContain(`"${topic}"`);
    }
    expect(toml).toContain('"app/uninstalled"');
    expect(toml).toContain('"app_subscriptions/update"');
  });

  it('sends every webhook to the one signed endpoint', () => {
    const uris = [...toml.matchAll(/^uri\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
    expect(uris.length).toBeGreaterThanOrEqual(3);
    expect(new Set(uris)).toEqual(new Set(['/api/v1/webhooks']));
  });

  it('asks Shopify for ids only on order and product webhooks, so no customer data is sent', () => {
    const block = toml
      .split('[[webhooks.subscriptions]]')
      .find((b) => b.includes('"orders/create"'))!;
    expect(block).toMatch(/include_fields\s*=\s*\[[^\]]*"id"/);
    expect(block).not.toMatch(/customer|email|address|phone/i);
  });
});
