/**
 * AES-256-GCM credential encryption (AGENTS.md §4.6).
 *
 * - Channel tokens and provider keys are encrypted with AES-256-GCM using
 *   ENCRYPTION_KEY from the environment.
 * - Payload format: `v1.<iv base64>.<authTag base64>.<ciphertext base64>`.
 * - Losing ENCRYPTION_KEY loses every credential — decrypt failures are loud,
 *   typed CryptoErrors, never silent.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { ConfigurationError, CryptoError } from "./errors";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const PAYLOAD_PREFIX = "v1";

export type EncryptionKey = Buffer;

/**
 * Derive a 32-byte key from ENCRYPTION_KEY. A raw 32-byte value is used
 * as-is; anything else (passphrase, hex, base64) is hashed with SHA-256.
 */
export function deriveKey(secret: string): EncryptionKey {
  if (secret.length === 0) {
    throw new ConfigurationError("ENCRYPTION_KEY must not be empty.");
  }
  const raw = Buffer.from(secret, "utf8");
  if (raw.length === KEY_LENGTH) {
    return raw;
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string, key: EncryptionKey): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    PAYLOAD_PREFIX,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string, key: EncryptionKey): string {
  const [prefix, ivB64, tagB64, dataB64] = payload.split(".");
  if (
    prefix !== PAYLOAD_PREFIX ||
    ivB64 === undefined ||
    tagB64 === undefined ||
    dataB64 === undefined
  ) {
    throw new CryptoError("Credential payload is malformed (wrong format or corrupted).");
  }
  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch (cause) {
    throw new CryptoError("Decryption failed — wrong ENCRYPTION_KEY or corrupted payload.", {
      cause,
    });
  }
}
