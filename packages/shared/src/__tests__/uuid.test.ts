import { describe, expect, it } from "vitest";

import { uuidv7 } from "../uuid";

const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  it("produces well-formed version-7, variant-10 UUIDs", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(uuidv7()).toMatch(UUIDV7_RE);
    }
  });

  it("is unique at scale", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      ids.add(uuidv7());
    }
    expect(ids.size).toBe(10_000);
  });

  it("sorts by creation time (later id sorts after earlier id)", async () => {
    const first = uuidv7();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = uuidv7();
    expect(second.localeCompare(first)).toBe(1);
  });
});
