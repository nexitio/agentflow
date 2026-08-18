import { describe, expect, it } from "vitest";

import { ValidationError } from "../errors";
import { createLogger, isSensitiveKey, redact, redactMessage } from "../logger";

function capture(): { stream: { write: (chunk: string) => void }; lines: string[] } {
  const lines: string[] = [];
  return {
    stream: { write: (chunk) => lines.push(chunk) },
    lines,
  };
}

function parse(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

function firstLine(lines: string[]): Record<string, unknown> {
  return parse(lines[0] ?? "");
}

describe("redactMessage", () => {
  it("scrubs emails, phone numbers, JWTs, and API tokens from free text", () => {
    expect(
      redactMessage("contact ada@example.com or 555-123-4567 token sk-abcdefghijklmnop1234"),
    ).toBe("contact [REDACTED] or [REDACTED] token [REDACTED]");
  });

  it("scrubs parenthesized and prefixed phone numbers", () => {
    expect(redactMessage("call +1 (415) 555-0199 today")).toBe("call [REDACTED] today");
  });

  it("scrubs sk-proj style API tokens", () => {
    expect(redactMessage("key sk-proj-abcdefghijklmnop here")).toBe("key [REDACTED] here");
  });

  it("never redacts UUIDs or run ids", () => {
    const uuid = "0196a2c0-0000-7000-8000-000000000001";
    expect(redactMessage(`run ${uuid} finished`)).toBe(`run ${uuid} finished`);
    // A 12-hex UUID group may contain a 10-11 digit run — still not a phone.
    expect(redactMessage("id 514b74e4-4d0e-75fc-a066-47084260821d")).toBe(
      "id 514b74e4-4d0e-75fc-a066-47084260821d",
    );
  });

  it("leaves ordinary text alone", () => {
    expect(redactMessage("flow published runId=abc123")).toBe("flow published runId=abc123");
  });
});

describe("isSensitiveKey / redact", () => {
  it("treats message-like keys as sensitive", () => {
    expect(isSensitiveKey("message")).toBe(true);
    expect(isSensitiveKey("phone_number")).toBe(true);
    expect(isSensitiveKey("latencyMs")).toBe(false);
  });

  it("redacts sensitive keys recursively and keeps safe fields", () => {
    const input = {
      runId: "0196a2c0-0000-7000-8000-000000000001",
      latencyMs: 42,
      tokenCount: 1337,
      message: { text: "my order is late", customer: { email: "ada@example.com" } },
    };
    const out = redact(input) as Record<string, unknown>;
    expect(out.runId).toBe(input.runId);
    expect(out.latencyMs).toBe(42);
    expect(out.tokenCount).toBe(1337);
    expect((out.message as Record<string, unknown>).text).toBe("[REDACTED]");
  });

  it("scrubs PII patterns inside values of non-sensitive keys", () => {
    const out = redact({ note: "reply to bob@example.com" }) as Record<string, unknown>;
    expect(out.note).toBe("reply to [REDACTED]");
  });
});

describe("createLogger", () => {
  it("emits one JSON line per entry with level and message", () => {
    const { stream, lines } = capture();
    const logger = createLogger({ stream });
    logger.info("health check", { service: "api" });
    expect(lines).toHaveLength(1);
    const entry = firstLine(lines);
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("health check");
    expect(entry.service).toBe("api");
  });

  it("redacts message bodies passed as structured fields (invariant §4.7)", () => {
    const { stream, lines } = capture();
    const logger = createLogger({ stream });
    logger.info("run failed", {
      runId: "0196a2c0-0000-7000-8000-000000000001",
      message: { text: "where is my refund, ada@example.com" },
    });
    const entry = firstLine(lines);
    const message = entry.message as Record<string, unknown>;
    expect(message.text).toBe("[REDACTED]");
  });

  it("serializes typed errors with code and redacted message", () => {
    const { stream, lines } = capture();
    const logger = createLogger({ stream });
    const error = new ValidationError("bad input from ada@example.com");
    logger.error("request failed", error, { nodeId: "node_1" });
    const entry = firstLine(lines);
    expect(entry.level).toBe("error");
    expect(entry.nodeId).toBe("node_1");
    const err = entry.err as Record<string, unknown>;
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toBe("bad input from [REDACTED]");
  });

  it("honors level filtering", () => {
    const { stream, lines } = capture();
    const logger = createLogger({ stream, level: "warn" });
    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("visible");
    expect(lines).toHaveLength(1);
    expect(firstLine(lines).msg).toBe("visible");
  });

  it("child loggers merge bindings", () => {
    const { stream, lines } = capture();
    const logger = createLogger({ stream, bindings: { service: "api" } });
    logger.child({ runId: "run_1" }).info("started");
    const entry = firstLine(lines);
    expect(entry.service).toBe("api");
    expect(entry.runId).toBe("run_1");
  });
});
