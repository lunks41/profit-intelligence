import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM envelope for Shopify access tokens at rest.
// Format: v1.<keyId>.<iv>.<authTag>.<ciphertext>  (base64url parts). The keyId allows rotation.

const VERSION = 'v1';

export interface TokenCrypto {
  encrypt(plaintext: string): { value: string; keyId: string };
  decrypt(value: string): string;
}

/** `keys` maps keyId -> base64 32-byte key. `activeKeyId` is used for new encryptions. */
export function createTokenCrypto(keys: Record<string, string>, activeKeyId: string): TokenCrypto {
  const buffers = new Map<string, Buffer>();
  for (const [id, b64] of Object.entries(keys)) {
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) throw new Error(`Encryption key "${id}" must be 32 bytes (base64)`);
    buffers.set(id, key);
  }
  if (!buffers.has(activeKeyId)) throw new Error(`Active encryption key "${activeKeyId}" missing`);

  return {
    encrypt(plaintext) {
      const key = buffers.get(activeKeyId)!;
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const parts = [VERSION, activeKeyId, iv, tag, ct].map((p) =>
        typeof p === 'string' ? p : p.toString('base64url'),
      );
      return { value: parts.join('.'), keyId: activeKeyId };
    },
    decrypt(value) {
      const [version, keyId, iv, tag, ct] = value.split('.');
      if (version !== VERSION || !keyId || !iv || !tag || ct === undefined) {
        throw new Error('Unsupported ciphertext format');
      }
      const key = buffers.get(keyId);
      if (!key) throw new Error('Unknown encryption key id');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ct, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
