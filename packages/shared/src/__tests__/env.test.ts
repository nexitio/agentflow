import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadEnv } from "../env";
import { ConfigurationError } from "../errors";

describe("loadEnv", () => {
  it("returns typed data for a valid environment", () => {
    const env = loadEnv(
      z.object({ PORT: z.coerce.number().default(3001), MODE: z.enum(["dev", "prod"]) }),
      { MODE: "dev" },
    );
    expect(env.PORT).toBe(3001);
    expect(env.MODE).toBe("dev");
  });

  it("fails fast with a plain-English message naming the missing var", () => {
    expect(() => loadEnv(z.object({ ENCRYPTION_KEY: z.string().min(1) }), {})).toThrowError(
      /ENCRYPTION_KEY/,
    );
    expect(() => loadEnv(z.object({ ENCRYPTION_KEY: z.string().min(1) }), {})).toThrow(
      ConfigurationError,
    );
  });
});
