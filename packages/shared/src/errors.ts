/**
 * Typed errors — never throw strings, never empty catches (AGENTS.md §9).
 * Every error carries a stable code the API, worker, and UI can branch on,
 * and a `toLog()` summary that is safe for the redacting logger.
 */

export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFIGURATION"
  | "PROVIDER"
  | "CRYPTO"
  | "INTERNAL";

export interface AgentFlowErrorOptions {
  code: ErrorCode;
  status?: number;
  cause?: unknown;
  details?: unknown;
}

export class AgentFlowError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, options: AgentFlowErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.code = options.code;
    this.status = options.status ?? 500;
    this.details = options.details;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  /** Compact, PII-free summary for logs. */
  toLog(): { name: string; code: ErrorCode; status: number; message: string } {
    return { name: this.name, code: this.code, status: this.status, message: this.message };
  }
}

export class ValidationError extends AgentFlowError {
  constructor(message: string, options: Omit<AgentFlowErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "VALIDATION", status: 400 });
  }
}

export class NotFoundError extends AgentFlowError {
  constructor(message: string, options: Omit<AgentFlowErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "NOT_FOUND", status: 404 });
  }
}

export class UnauthorizedError extends AgentFlowError {
  constructor(message: string, options: Omit<AgentFlowErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "UNAUTHORIZED", status: 401 });
  }
}

export class ForbiddenError extends AgentFlowError {
  constructor(message: string, options: Omit<AgentFlowErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "FORBIDDEN", status: 403 });
  }
}

export class ConfigurationError extends AgentFlowError {
  constructor(message: string, options: Omit<AgentFlowErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "CONFIGURATION", status: 500 });
  }
}

export interface ProviderErrorOptions {
  provider: string;
  status?: number;
  cause?: unknown;
  details?: unknown;
}

export class ProviderError extends AgentFlowError {
  constructor(message: string, options: ProviderErrorOptions) {
    super(message, {
      code: "PROVIDER",
      status: options.status ?? 502,
      cause: options.cause,
      details: { provider: options.provider, ...(options.details ?? {}) },
    });
  }
}

export class CryptoError extends AgentFlowError {
  constructor(message: string, options: Omit<AgentFlowErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "CRYPTO", status: 500 });
  }
}
