/**
 * UUIDv7 generation (AGENTS.md §6: time-sortable ids).
 *
 * Format: 48-bit unix-ms timestamp | 4-bit version (7) + 12-bit rand_a |
 * 2-bit variant (10) + 62-bit rand_b. IDs sort by creation time.
 *
 * Generated client-side ($defaultFn) rather than via Postgres 18's native
 * uuidv7(), so ids work on any Postgres 16+ the operator already runs and the
 * same generator is usable in tests and seed data.
 */

import { randomBytes } from "node:crypto";

const VERSION_AND_RAND_A_MASK = 0x0fff; // 12 bits of randomness in bytes 6-7
const VARIANT_AND_RAND_B_MASK = 0x3f; // 6 bits of randomness in byte 8

export function uuidv7(): string {
  const timestamp = BigInt(Date.now());
  const rand = randomBytes(10); // 80 bits: 12 (rand_a) + 62 (rand_b) + 6 spare
  const randA = BigInt(rand.readUInt16BE(0)) & BigInt(VERSION_AND_RAND_A_MASK);
  const randB = rand.subarray(2); // 8 bytes; we use 62 of the 64 bits

  const bytes = Buffer.alloc(16);
  // 48-bit timestamp: top 32 bits, then low 16 bits.
  bytes.writeUInt32BE(Number((timestamp >> 16n) & 0xffffffffn), 0);
  bytes.writeUInt16BE(Number(timestamp & 0xffffn), 4);
  // byte 6: version 7 (0b0111) in the high nibble, top 4 bits of rand_a below.
  bytes[6] = 0x70 | (Number(randA >> 8n) & 0x0f);
  bytes[7] = Number(randA & 0xffn);
  // byte 8: variant 10 in the top 2 bits, 6 bits of rand_b below.
  bytes[8] = 0x80 | (randB.readUInt8(0) & VARIANT_AND_RAND_B_MASK);
  randB.copy(bytes, 9, 1);

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
