import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTokenCrypto } from './token-crypto.js';

const key = () => randomBytes(32).toString('base64');

describe('token crypto', () => {
  it('round-trips and never stores plaintext', () => {
    const c = createTokenCrypto({ k1: key() }, 'k1');
    const { value, keyId } = c.encrypt('shpat_secret_token');
    expect(keyId).toBe('k1');
    expect(value).not.toContain('shpat_secret_token');
    expect(c.decrypt(value)).toBe('shpat_secret_token');
  });

  it('uses a fresh IV each time', () => {
    const c = createTokenCrypto({ k1: key() }, 'k1');
    expect(c.encrypt('same').value).not.toBe(c.encrypt('same').value);
  });

  it('rejects tampered ciphertext', () => {
    const c = createTokenCrypto({ k1: key() }, 'k1');
    const parts = c.encrypt('token').value.split('.');
    parts[4] = Buffer.from('tampered').toString('base64url');
    expect(() => c.decrypt(parts.join('.'))).toThrow();
  });

  it('rejects the wrong key', () => {
    const { value } = createTokenCrypto({ k1: key() }, 'k1').encrypt('token');
    expect(() => createTokenCrypto({ k1: key() }, 'k1').decrypt(value)).toThrow();
  });

  it('supports key rotation: old ciphertext decrypts, new uses the active key', () => {
    const old = key();
    const { value } = createTokenCrypto({ k1: old }, 'k1').encrypt('token');
    const rotated = createTokenCrypto({ k1: old, k2: key() }, 'k2');
    expect(rotated.decrypt(value)).toBe('token');
    expect(rotated.encrypt('x').keyId).toBe('k2');
  });

  it('rejects keys of the wrong length and unknown formats', () => {
    expect(() => createTokenCrypto({ k1: 'c2hvcnQ=' }, 'k1')).toThrow(/32 bytes/);
    expect(() => createTokenCrypto({ k1: key() }, 'k1').decrypt('garbage')).toThrow();
  });
});
