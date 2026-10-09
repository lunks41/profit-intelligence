// secret-scan:ignore-file (fake secrets, used to prove that real ones are found or removed)
import { describe, expect, it } from 'vitest';
import { createLogger, redact, redactValue } from './logger.js';
import type { Level } from './logger.js';

describe('redact', () => {
  it('removes Shopify tokens, JWTs, bearer values and connection string passwords', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456';
    const shopifyToken = 'shpat_' + '0123456789abcdef' + '0123456789abcdef';
    expect(redact(`token ${shopifyToken} used`)).toBe('token shp*** used');
    expect(redact(`got ${jwt} here`)).toBe('got jwt*** here');
    expect(redact('Authorization: Bearer abc.def-ghi_123')).not.toContain('abc.def');
    expect(redact('postgresql://app:P%40ssw0rd@db.example:5432/x')).toBe(
      'postgresql://app:***@db.example:5432/x',
    );
    expect(redact('smtp://mailer:hunter2@mail.example')).toBe('smtp://mailer:***@mail.example');
  });

  it('removes values next to words that name a secret', () => {
    expect(redact('api_key=abc123 and password: hunter2')).toBe('api_key=*** and password: ***');
    expect(redact('{"client_secret":"xyz789"}')).not.toContain('xyz789');
    expect(redact('secret=top&other=1')).toBe('secret=***&other=1');
  });

  it('leaves ordinary text alone', () => {
    const text = 'Imported 82 orders for shop 5c0e in 1.2s (stage=orders)';
    expect(redact(text)).toBe(text);
  });

  it('is safe on empty and very long input', () => {
    expect(redact('')).toBe('');
    expect(redact('a'.repeat(200_000)).length).toBe(200_000);
  });
});

describe('redactValue', () => {
  it('hides fields by name at any depth and scrubs strings inside', () => {
    const out = redactValue({
      shop: 'a.myshopify.com',
      headers: { authorization: 'Bearer abcdef123456', 'x-other': 'fine' },
      nested: { accessToken: 'shpat_0123456789abcdef', note: 'used shpat_0123456789abcdef today' },
      list: ['password=abc', 1, null],
    });
    expect(out).toEqual({
      shop: 'a.myshopify.com',
      headers: { authorization: '***', 'x-other': 'fine' },
      nested: { accessToken: '***', note: 'used shp*** today' },
      list: ['password=***', 1, null],
    });
  });

  it('stops at a depth limit and a list length limit instead of walking huge or cyclic data', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(JSON.stringify(redactValue(cyclic))).toContain('[object]');
    expect((redactValue(Array.from({ length: 500 }, (_, i) => i)) as unknown[]).length).toBe(50);
  });
});

describe('createLogger', () => {
  const capture = () => {
    const lines: Array<{ level: Level; json: Record<string, unknown> }> = [];
    return {
      lines,
      write: (level: Level, line: string) => lines.push({ level, json: JSON.parse(line) }),
    };
  };
  const now = () => new Date('2026-10-09T12:00:00.000Z');

  it('writes one JSON object per line with time, level, service and message', () => {
    const c = capture();
    createLogger('worker', { write: c.write, now }).info('import finished', {
      shop: 's1',
      orders: 82,
    });
    expect(c.lines).toEqual([
      {
        level: 'info',
        json: {
          shop: 's1',
          orders: 82,
          time: '2026-10-09T12:00:00.000Z',
          level: 'info',
          service: 'worker',
          msg: 'import finished',
        },
      },
    ]);
  });

  it('never writes a secret, in the message or in the fields', () => {
    const c = capture();
    const log = createLogger('api', { write: c.write, now });
    log.error('failed with token shpat_0123456789abcdef', {
      authorization: 'Bearer abcdef123456',
      url: 'postgres://u:pw@h/db',
    });
    const text = JSON.stringify(c.lines);
    expect(text).not.toContain('shpat_0123');
    expect(text).not.toContain('abcdef123456');
    expect(text).not.toContain(':pw@');
  });

  it('a field cannot overwrite the fixed keys', () => {
    const c = capture();
    createLogger('api', { write: c.write, now }).warn('real', {
      level: 'debug',
      msg: 'fake',
      service: 'x',
    });
    expect(c.lines[0]!.json).toMatchObject({ level: 'warn', msg: 'real', service: 'api' });
  });

  it('skips levels below the minimum', () => {
    const c = capture();
    const log = createLogger('api', { write: c.write, now, level: 'warn' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(c.lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });
});
