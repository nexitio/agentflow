import { describe, expect, it } from "vitest";
import { decryptSecret, deriveKey, encryptSecret } from "../crypto";
import { ConfigurationError, CryptoError } from "../errors";

const KEY = "0123456789abcdef0123456789abcdef"; // 32 bytes

describe("deriveKey", () => {
  it("uses a 32-byte key as-is and hashes anything else to 32 bytes", () => {
    expect(deriveKey(KEY)).toHaveLength(32);
    expect(deriveKey("some-passphrase")).toHaveLength(32);
  });

  it("rejects an empty key", () => {
    expect(() => deriveKey("")).toThrow(ConfigurationError);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a credential", () => {
    const key = deriveKey(KEY);
    const payload = encryptSecret("EAAG-app-page-token", key);
    expect(payload.startsWith("v1.")).toBe(true);
    expect(decryptSecret(payload, key)).toBe("EAAG-app-page-token");
  });

  it("produces a different ciphertext every time (random IV)", () => {
    const key = deriveKey(KEY);
    const a = encryptSecret("secret", key);
    const b = encryptSecret("secret", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe(decryptSecret(b, key));
  });

  it("fails loudly with the wrong key (invariant §4.6)", () => {
    const payload = encryptSecret("secret", deriveKey(KEY));
    expect(() => decryptSecret(payload, deriveKey("a-different-key"))).toThrow(CryptoError);
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-payload", deriveKey(KEY))).toThrow(CryptoError);
  });
});
