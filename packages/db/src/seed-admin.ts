/**
 * Seed the default admin user — idempotent, safe to re-run.
 *
 * Usage:
 *   pnpm --filter @agentflow/db db:seed:admin
 *
 * Requires DATABASE_URL and ENCRYPTION_KEY in the environment.
 * If no admin exists, creates one with a random password printed once.
 * If an admin already exists, prints a reminder of the existing email.
 */

import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { loadEnv } from "@agentflow/shared/env";
import { hashPassword } from "@agentflow/shared/auth";
import { logger } from "@agentflow/shared/logger";
import { z } from "zod";

import { createDbClient } from "./client";
import * as schema from "./schema";
import { BUILTIN_WORKSPACE_ID, ensureBuiltinWorkspace } from "./seed";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
});

const env = loadEnv(envSchema);
const { client, db } = createDbClient(env.DATABASE_URL);

try {
  // Ensure the built-in workspace exists
  await ensureBuiltinWorkspace(db);

  // Check if any admin user already exists
  const existingAdmin = await db.query.users.findFirst({
    where: eq(schema.users.role, "admin"),
  });

  if (existingAdmin !== undefined) {
    logger.info("admin user already exists", {
      service: "seed",
      email: existingAdmin.email,
      userId: existingAdmin.id,
    });
    console.log(`\n✅ Admin user already exists: ${existingAdmin.email}`);
    console.log("   No action taken. To create another user, use the /login page.\n");
  } else {
    // Generate a secure random password: 16 chars, alphanumeric + symbols
    const rawPassword = generateSecurePassword(16);
    const { hash, salt } = await hashPassword(rawPassword);

    const [user] = await db
      .insert(schema.users)
      .values({
        workspaceId: BUILTIN_WORKSPACE_ID,
        email: "admin@agentflow.local",
        name: "Admin",
        passwordHash: `${salt}:${hash}`,
        role: "admin",
      })
      .returning({ id: schema.users.id, email: schema.users.email });

    if (user === undefined) {
      throw new Error("Failed to create admin user");
    }

    // Create an initial audit log entry
    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.id,
      action: "user.register",
      resourceType: "user",
      resourceId: user.id,
      metadata: { source: "seed-script" },
    });

    logger.info("admin user created", {
      service: "seed",
      email: user.email,
      userId: user.id,
    });

    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log("║         🚀 AgentFlow Admin User Created         ║");
    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║  Email:    ${user.email.padEnd(36)}║`);
    console.log(`║  Password: ${rawPassword.padEnd(36)}║`);
    console.log("╠══════════════════════════════════════════════════╣");
    console.log("║  ⚠️  Save this password — it won't be shown     ║");
    console.log("║     again. You can change it after logging in.  ║");
    console.log("╚══════════════════════════════════════════════════╝\n");
  }
} finally {
  await client.end();
}

/**
 * Generate a cryptographically secure random password.
 * Characters: uppercase, lowercase, digits, and safe symbols.
 */
function generateSecurePassword(length: number): string {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O (ambiguous)
  const lowercase = "abcdefghjkmnpqrstuvwxyz"; // no i, l, o (ambiguous)
  const digits = "23456789"; // no 0, 1 (ambiguous)
  const symbols = "!@#$%^&*";
  const allChars = uppercase + lowercase + digits + symbols;

  // Ensure at least one of each category
  const pick = (chars: string) => chars[randomBytes(1)[0]! % chars.length]!;
  let password = pick(uppercase) + pick(lowercase) + pick(digits) + pick(symbols);

  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += allChars[randomBytes(1)[0]! % allChars.length];
  }

  // Shuffle the password using Fisher-Yates
  const arr = password.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    const temp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = temp;
  }

  return arr.join("");
}
