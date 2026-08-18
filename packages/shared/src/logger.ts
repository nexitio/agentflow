/**
 * Redacting logger — the only logger in `api` and `worker` (AGENTS.md §4.7).
 *
 * - Log run IDs, node IDs, latencies, token counts, error codes.
 * - NEVER log message text, customer names, phone numbers, email addresses,
 *   or provider tokens — fields whose keys look sensitive are redacted, and
 *   free-text messages are scrubbed for emails, phone numbers, JWTs, and
 *   `sk_`/`pk_` tokens.
 * - Emits single-line JSON for containers.
 */

import { AgentFlowError } from "./errors";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY =
  /(?:message|text|body|content|email|phone|address|token|secret|password|passwd|api[_-]?key|authorization|signature|session|cookie|name)/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// Formatted phone numbers: 3+ digit groups (1-4 digits each, parens allowed)
// separated by ., space, or -. Lookarounds stop us from matching digit-hyphen
// runs inside UUIDs, ids, or timestamps ("0-0000-7000-8000-000000000001");
// the hex guard blocks matches embedded in hex strings ("1d9c4120-1266-797c-").
const PHONE_RE = /(?<![\da-f-])\+?(?:\(?\d{1,4}\)?[\s.-]){2,5}\(?\d{1,4}\)?(?![\da-f-])/g;
// Bare 10-11 digit runs that aren't part of a longer number or a hex string
// (a 12-hex UUID group can hold "47084260821" — blocked by the hex guard).
const BARE_PHONE_RE = /(?<![\da-f])\d{10,11}(?![\da-f])/g;
const JWT_RE = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;
// Provider API tokens, e.g. sk-proj-abc..., sk_abc..., pk_abc...
const TOKEN_RE = /\b(?:sk|pk)[-_][A-Za-z0-9-]{16,}\b/g;

export const REDACTED = "[REDACTED]";

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Scrub PII patterns from free text (applied to log messages). */
export function redactMessage(text: string): string {
  return text
    .replace(EMAIL_RE, REDACTED)
    .replace(PHONE_RE, REDACTED)
    .replace(BARE_PHONE_RE, REDACTED)
    .replace(JWT_RE, REDACTED)
    .replace(TOKEN_RE, REDACTED);
}

/** Recursively redact a structured value: sensitive keys and PII patterns. */
export function redact(value: unknown, key = ""): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    if (key !== "" && isSensitiveKey(key)) {
      return REDACTED;
    }
    return redactMessage(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, key));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redact(v, k);
  }
  return out;
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      code:
        error instanceof AgentFlowError
          ? error.code
          : ((error as { code?: unknown }).code ?? undefined),
      status: error instanceof AgentFlowError ? error.status : undefined,
      message: redactMessage(error.message),
      cause: error.cause !== undefined ? serializeError(error.cause) : undefined,
    };
  }
  return redact(error);
}

export interface LoggerOptions {
  level?: LogLevel;
  stream?: { write(chunk: string): void };
  bindings?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, error?: unknown, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const stream = options.stream ?? process.stdout;
  const baseBindings = options.bindings ?? {};

  function write(
    entryLevel: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown,
  ): void {
    if (LEVELS[entryLevel] < LEVELS[level]) {
      return;
    }
    const record: Record<string, unknown> = {
      time: new Date().toISOString(),
      level: entryLevel,
      msg: redactMessage(message),
      ...baseBindings,
      ...(fields !== undefined ? (redact(fields) as Record<string, unknown>) : {}),
    };
    if (error !== undefined) {
      record.err = serializeError(error);
    }
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({
        time: new Date().toISOString(),
        level: entryLevel,
        msg: redactMessage(message),
        err: "[unserializable]",
      });
    }
    stream.write(`${line}\n`);
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, errorValue, fields) => write("error", message, fields, errorValue),
    child: (bindings) =>
      createLogger({ level, stream, bindings: { ...baseBindings, ...bindings } }),
  };
}

export const logger = createLogger();
