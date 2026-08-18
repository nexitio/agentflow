import { describe, expect, it } from "vitest";

import { createApp } from "./app";

describe("api", () => {
  it("answers /health", async () => {
    const res = await createApp().request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("api");
  });
});
