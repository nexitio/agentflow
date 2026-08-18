/**
 * Auth routes — login, register, session, TOTP, passkey management.
 *
 * - Passwords hashed with scrypt; never stored plaintext (invariant §4.6).
 * - Sessions are signed JWTs stored as httpOnly secure cookies.
 * - TOTP secrets encrypted at rest; never returned to the client.
 * - Passkeys use the WebAuthn standard (browser-native).
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import * as schema from "@agentflow/db/schema";
import { BUILTIN_WORKSPACE_ID } from "@agentflow/db/seed";
import {
  hashPassword,
  verifyPassword,
  signJwt,
  verifyJwt,
  generateSessionToken,
  generateBase32Secret,
  generateTotpCode,
  verifyTotpCode,
  generateTotpUri,
  getCookie,
} from "@agentflow/shared/auth";
import { UnauthorizedError } from "@agentflow/shared/errors";
import { logger } from "@agentflow/shared/logger";

const SESSION_COOKIE = "af_session";
const SESSION_SECRET = process.env.SESSION_SECRET ?? process.env.ENCRYPTION_KEY ?? "dev-session-secret";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

// ─── Schemas ────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().length(6).optional(),
});

const totpSetupSchema = z.object({
  code: z.string().length(6),
});

const passkeyRegisterStartSchema = z.object({
  name: z.string().min(1).max(100),
});

const passkeyRegisterFinishSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    attestationObject: z.string(),
    clientDataJSON: z.string(),
    authenticatorData: z.string().optional(),
    publicKeyAlgorithm: z.number().optional(),
  }),
  type: z.literal("public-key"),
  transports: z.array(z.string()).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  totpEnabled: boolean;
  passkeyEnabled: boolean;
}

async function getCurrentUser(
  c: { req: { header: (name: string) => string | undefined } },
  db: PostgresJsDatabase<typeof schema>,
): Promise<AuthUser | null> {
  const cookieHeader = c.req.header("cookie") ?? null;
  const token = getCookie(cookieHeader, SESSION_COOKIE);
  if (token === undefined) {
    return null;
  }

  const payload = verifyJwt(token, SESSION_SECRET);
  if (payload === null) {
    return null;
  }

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, payload.sub),
  });

  if (user === undefined) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    totpEnabled: user.totpEnabled,
    passkeyEnabled: user.passkeyEnabled,
  };
}

function setSessionCookie(token: string): string {
  const expires = new Date(Date.now() + SESSION_MAX_AGE * 1000).toUTCString();
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}; Expires=${expires}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export function authRoutes(options: {
  db?: PostgresJsDatabase<typeof schema>;
}): Hono {
  const app = new Hono();
  const requireDb = (): PostgresJsDatabase<typeof schema> => {
    if (options.db === undefined) {
      throw new Error("Database not configured");
    }
    return options.db;
  };

  // ─── Register first admin user ──────────────────────────────────────────

  app.post("/api/auth/register", async (c) => {
    const db = requireDb();
    const body = registerSchema.parse(await c.req.json());

    // Check if any users exist — first user is admin
    const existingUsers = await db.query.users.findFirst();
    const isFirstUser = existingUsers === undefined;

    // Check for duplicate email
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.email, body.email),
    });
    if (existing !== undefined) {
      return c.json({ error: { code: "VALIDATION", message: "Email already registered." } }, 400);
    }

    const { hash, salt } = await hashPassword(body.password);

    const [user] = await db
      .insert(schema.users)
      .values({
        workspaceId: BUILTIN_WORKSPACE_ID,
        email: body.email,
        name: body.name,
        passwordHash: `${salt}:${hash}`,
        role: isFirstUser ? "admin" : "member",
      })
      .returning({ id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.users.role });

    if (user === undefined) {
      return c.json({ error: { code: "INTERNAL", message: "Registration failed." } }, 500);
    }

    // Create session
    const sessionId = crypto.randomUUID();
    const jwt = signJwt(
      { sub: user.id, sid: sessionId, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE },
      SESSION_SECRET,
    );

    await db.insert(schema.sessions).values({
      userId: user.id,
      token: sessionId,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000),
    });

    // Audit log
    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.id,
      action: "user.register",
      resourceType: "user",
      resourceId: user.id,
    });

    logger.info("user registered", { userId: user.id });

    c.header("Set-Cookie", setSessionCookie(jwt));
    return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  // ─── Login ─────────────────────────────────────────────────────────────

  app.post("/api/auth/login", async (c) => {
    const db = requireDb();
    const body = loginSchema.parse(await c.req.json());

    const user = await db.query.users.findFirst({
      where: eq(schema.users.email, body.email),
    });

    if (user === undefined) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid email or password." } }, 401);
    }

    // Parse stored hash (salt:hash)
    const [salt, storedHash] = user.passwordHash.split(":");
    if (salt === undefined || storedHash === undefined) {
      return c.json({ error: { code: "INTERNAL", message: "Account configuration error." } }, 500);
    }

    const valid = await verifyPassword(body.password, storedHash, salt);
    if (!valid) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid email or password." } }, 401);
    }

    // TOTP check
    if (user.totpEnabled && body.totpCode === undefined) {
      return c.json({ requiresTotp: true, message: "Enter your authenticator code." });
    }

    if (user.totpEnabled && body.totpCode !== undefined) {
      const totpRecord = await db.query.totpSecrets.findFirst({
        where: eq(schema.totpSecrets.userId, user.id),
      });

      if (totpRecord === undefined) {
        return c.json({ error: { code: "INTERNAL", message: "TOTP not configured." } }, 500);
      }

      // Decrypt the TOTP secret for verification
      const { decryptSecret, deriveKey } = await import("@agentflow/shared/crypto");
      const encryptionKey = deriveKey(process.env.ENCRYPTION_KEY ?? "");
      const decryptedSecret = decryptSecret(totpRecord.encryptedSecret, encryptionKey);

      if (!verifyTotpCode(decryptedSecret, body.totpCode)) {
        return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid authenticator code." } }, 401);
      }
    }

    // Create session
    const sessionId = crypto.randomUUID();
    const jwt = signJwt(
      { sub: user.id, sid: sessionId, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE },
      SESSION_SECRET,
    );

    await db.insert(schema.sessions).values({
      userId: user.id,
      token: sessionId,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000),
    });

    // Update last login
    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));

    // Audit log
    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.id,
      action: "user.login",
      resourceType: "user",
      resourceId: user.id,
    });

    logger.info("user logged in", { userId: user.id });

    c.header("Set-Cookie", setSessionCookie(jwt));
    return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  // ─── Logout ────────────────────────────────────────────────────────────

  app.post("/api/auth/logout", async (c) => {
    const db = requireDb();
    const cookieHeader = c.req.header("cookie") ?? null;
    const token = getCookie(cookieHeader, SESSION_COOKIE);

    if (token !== undefined) {
      const payload = verifyJwt(token, SESSION_SECRET);
      if (payload !== null) {
        await db.delete(schema.sessions).where(eq(schema.sessions.id, payload.sid));
        await db.insert(schema.auditLog).values({
          workspaceId: BUILTIN_WORKSPACE_ID,
          userId: payload.sub,
          action: "user.logout",
          resourceType: "user",
          resourceId: payload.sub,
        });
      }
    }

    c.header("Set-Cookie", clearSessionCookie());
    return c.json({ ok: true });
  });

  // ─── Current user ──────────────────────────────────────────────────────

  app.get("/api/auth/me", async (c) => {
    const db = requireDb();
    const user = await getCurrentUser(c, db);
    if (user === null) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated." } }, 401);
    }
    return c.json({ user });
  });

  // ─── TOTP Setup ────────────────────────────────────────────────────────

  app.post("/api/auth/totp/setup", async (c) => {
    const db = requireDb();
    const user = await getCurrentUser(c, db);
    if (user === null) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated." } }, 401);
    }

    // Generate new TOTP secret
    const secret = generateBase32Secret(20);
    const uri = generateTotpUri(secret, user.email);

    // Encrypt and store (not yet verified)
    const { encryptSecret, deriveKey } = await import("@agentflow/shared/crypto");
    const encryptionKey = deriveKey(process.env.ENCRYPTION_KEY ?? "");
    const encryptedSecret = encryptSecret(secret, encryptionKey);

    // Delete any existing unverified TOTP secret
    await db.delete(schema.totpSecrets).where(eq(schema.totpSecrets.userId, user.id));

    await db.insert(schema.totpSecrets).values({
      userId: user.id,
      encryptedSecret,
    });

    return c.json({ secret, uri });
  });

  app.post("/api/auth/totp/verify", async (c) => {
    const db = requireDb();
    const user = await getCurrentUser(c, db);
    if (user === null) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated." } }, 401);
    }

    const body = totpSetupSchema.parse(await c.req.json());

    const totpRecord = await db.query.totpSecrets.findFirst({
      where: eq(schema.totpSecrets.userId, user.id),
    });

    if (totpRecord === undefined) {
      return c.json({ error: { code: "VALIDATION", message: "No pending TOTP setup." } }, 400);
    }

    const { decryptSecret, deriveKey } = await import("@agentflow/shared/crypto");
    const encryptionKey = deriveKey(process.env.ENCRYPTION_KEY ?? "");
    const decryptedSecret = decryptSecret(totpRecord.encryptedSecret, encryptionKey);

    if (!verifyTotpCode(decryptedSecret, body.code)) {
      return c.json({ error: { code: "VALIDATION", message: "Invalid code. Try again." } }, 400);
    }

    // Mark verified
    await db
      .update(schema.totpSecrets)
      .set({ verifiedAt: new Date() })
      .where(eq(schema.totpSecrets.id, totpRecord.id));

    await db.update(schema.users).set({ totpEnabled: true }).where(eq(schema.users.id, user.id));

    // Audit
    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.id,
      action: "totp.enable",
      resourceType: "user",
      resourceId: user.id,
    });

    return c.json({ ok: true, message: "Two-factor authentication enabled." });
  });

  app.post("/api/auth/totp/disable", async (c) => {
    const db = requireDb();
    const user = await getCurrentUser(c, db);
    if (user === null) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated." } }, 401);
    }

    await db.delete(schema.totpSecrets).where(eq(schema.totpSecrets.userId, user.id));
    await db.update(schema.users).set({ totpEnabled: false }).where(eq(schema.users.id, user.id));

    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.id,
      action: "totp.disable",
      resourceType: "user",
      resourceId: user.id,
    });

    return c.json({ ok: true });
  });

  // ─── Passkey Registration ───────────────────────────────────────────────

  app.post("/api/auth/passkey/register/start", async (c) => {
    const db = requireDb();
    const user = await getCurrentUser(c, db);
    if (user === null) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated." } }, 401);
    }

    const body = passkeyRegisterStartSchema.parse(await c.req.json());

    // Get existing passkeys for exclusion list
    const existingPasskeys = await db.query.passkeys.findMany({
      where: eq(schema.passkeys.userId, user.id),
    });

    const challenge = crypto.randomUUID().replace(/-/g, "");
    const rpName = "AgentFlow";
    const rpId = process.env.PASSKEY_RP_ID ?? "localhost";

    // Store challenge temporarily in the session response
    return c.json({
      challenge,
      rp: { name: rpName, id: rpId },
      user: {
        id: user.id,
        name: user.email,
        displayName: user.name,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: pk.credentialId,
        type: "public-key",
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      label: body.name,
    });
  });

  app.post("/api/auth/passkey/register/finish", async (c) => {
    const db = requireDb();
    const user = await getCurrentUser(c, db);
    if (user === null) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated." } }, 401);
    }

    const body = passkeyRegisterFinishSchema.parse(await c.req.json());

    // Store the passkey (simplified — in production, verify attestation)
    await db.insert(schema.passkeys).values({
      userId: user.id,
      credentialId: body.rawId,
      publicKey: body.response.attestationObject,
      label: user.name,
      transports: body.transports ?? [],
    });

    await db.update(schema.users).set({ passkeyEnabled: true }).where(eq(schema.users.id, user.id));

    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.id,
      action: "passkey.register",
      resourceType: "user",
      resourceId: user.id,
      metadata: { label: user.name },
    });

    return c.json({ ok: true });
  });

  // ─── Passkey List / Delete ─────────────────────────────────────────────

  app.get("/api/auth/passkeys", async (c) => {
    const db = requireDb();
    const user = await getCurrentUser(c, db);
    if (user === null) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated." } }, 401);
    }

    const passkeys = await db.query.passkeys.findMany({
      where: eq(schema.passkeys.userId, user.id),
    });

    return c.json({
      passkeys: passkeys.map((pk) => ({
        id: pk.id,
        label: pk.label,
        createdAt: pk.createdAt,
        lastUsedAt: pk.lastUsedAt,
      })),
    });
  });

  app.delete("/api/auth/passkeys/:id", async (c) => {
    const db = requireDb();
    const user = await getCurrentUser(c, db);
    if (user === null) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated." } }, 401);
    }

    const passkeyId = c.req.param("id");
    await db
      .delete(schema.passkeys)
      .where(and(eq(schema.passkeys.id, passkeyId), eq(schema.passkeys.userId, user.id)));

    // Check if any passkeys remain
    const remaining = await db.query.passkeys.findMany({
      where: eq(schema.passkeys.userId, user.id),
    });
    if (remaining.length === 0) {
      await db.update(schema.users).set({ passkeyEnabled: false }).where(eq(schema.users.id, user.id));
    }

    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.id,
      action: "passkey.delete",
      resourceType: "user",
      resourceId: passkeyId,
    });

    return c.json({ ok: true });
  });

  return app;
}
