/**
 * Authentication utilities — password hashing, JWT, TOTP (AGENTS.md §4.6).
 *
 * - Passwords hashed with scrypt (Node.js built-in, no new dependency).
 * - JWT signed with HMAC-SHA256 using SESSION_SECRET.
 * - TOTP uses HMAC-SHA1 (RFC 6238) with base32 secrets.
 * - WebAuthn (passkeys) handled client-side with browser APIs + server verification.
 */

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// ─── Password hashing (scrypt) ──────────────────────────────────────────────

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

export interface PasswordResult {
  hash: string;
  salt: string;
}

export async function hashPassword(password: string): Promise<PasswordResult> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
      },
      (err, derivedKey) => {
        if (err !== null) {
          reject(err);
          return;
        }
        resolve({
          hash: derivedKey.toString("hex"),
          salt,
        });
      },
    );
  });
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  salt: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
      },
      (err, derivedKey) => {
        if (err !== null) {
          reject(err);
          return;
        }
        const stored = Buffer.from(storedHash, "hex");
        if (derivedKey.length !== stored.length) {
          resolve(false);
          return;
        }
        resolve(timingSafeEqual(derivedKey, stored));
      },
    );
  });
}

// ─── JWT (HMAC-SHA256) ─────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string; // user id
  sid: string; // session id
  email: string;
  role: string;
  exp: number; // unix seconds
  iat: number;
}

/**
 * Encode a JWT using HMAC-SHA256 with no external dependency.
 * Format: base64url(header).base64url(payload).base64url(signature)
 */
export function signJwt(
  payload: Omit<JwtPayload, "iat">,
  secret: string,
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const iat = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;
  const signature = createHash("sha256")
    .update(data)
    .update(secret)
    .digest("base64url");

  return `${data}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signature] = parts;
  if (headerB64 === undefined || payloadB64 === undefined || signature === undefined) {
    return null;
  }

  const data = `${headerB64}.${payloadB64}`;
  const expectedSig = createHash("sha256")
    .update(data)
    .update(secret)
    .digest("base64url");

  const sigBuf = Buffer.from(signature, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");

  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as JwtPayload;
    if (payload.exp !== undefined && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function generateSessionToken(secret: string): string {
  return randomBytes(32).toString("base64url");
}

// ─── TOTP (RFC 6238) ────────────────────────────────────────────────────────

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateBase32Secret(length = 20): string {
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < bytes.length; i++) {
    result += BASE32_CHARS[bytes[i]! & 0x1f];
  }
  return result;
}

export function generateTotpCode(secret: string, timeStep = 30): string {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / timeStep);

  // Convert counter to 8-byte big-endian buffer
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter & 0xffffffff, 4);

  // HMAC-SHA1
  const hmac = createHash("sha256").update(key).update(counterBuf).digest();
  // Actually, TOTP uses HMAC-SHA1
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const hmacSha1 = createHmac("sha1", key).update(counterBuf).digest();

  const offset = hmacSha1[hmacSha1.length - 1]! & 0x0f;
  const code =
    ((hmacSha1[offset]! & 0x7f) << 24) |
    ((hmacSha1[offset + 1]! & 0xff) << 16) |
    ((hmacSha1[offset + 2]! & 0xff) << 8) |
    (hmacSha1[offset + 3]! & 0xff);

  return String(code % 1_000_000).padStart(6, "0");
}

export function verifyTotpCode(secret: string, code: string, window = 1): boolean {
  const timeStep = 30;
  const now = Math.floor(Date.now() / 1000 / timeStep);

  for (let i = -window; i <= window; i++) {
    const counter = now + i;
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    counterBuf.writeUInt32BE(counter & 0xffffffff, 4);

    const key = base32Decode(secret);
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const hmac = createHmac("sha1", key).update(counterBuf).digest();

    const offset = hmac[hmac.length - 1]! & 0x0f;
    const expected =
      ((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff);

    const expectedCode = String(expected % 1_000_000).padStart(6, "0");

    if (timingSafeEqual(Buffer.from(code), Buffer.from(expectedCode))) {
      return true;
    }
  }
  return false;
}

export function generateTotpUri(
  secret: string,
  email: string,
  issuer = "AgentFlow",
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function base64UrlEncode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

function base64UrlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function base32Decode(encoded: string): Buffer {
  const chars = encoded.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const char of chars) {
    const val = BASE32_CHARS.indexOf(char);
    if (val === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// ─── Cookie helpers ──────────────────────────────────────────────────────────

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === null) {
    return cookies;
  }
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

export function getCookie(
  header: string | null,
  name: string,
): string | undefined {
  return parseCookies(header)[name];
}
