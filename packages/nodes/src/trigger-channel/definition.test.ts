import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { triggerChannelDefinition, triggerChannelParamsSchema } from "./definition";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/params.json", import.meta.url)), "utf8"),
) as unknown;

describe("trigger-channel", () => {
  it("round-trips its params (serialize → deserialize → validate)", () => {
    const parsed = triggerChannelParamsSchema.parse(JSON.parse(JSON.stringify(fixture)));
    expect(parsed).toEqual(fixture);
  });

  it("defaults are valid params and every channel is accepted", () => {
    expect(
      triggerChannelParamsSchema.safeParse(triggerChannelDefinition.paramDefaults()).success,
    ).toBe(true);
    for (const channel of ["messenger", "instagram", "whatsapp", "tiktok", "widget"]) {
      expect(triggerChannelParamsSchema.safeParse({ channel }).success).toBe(true);
    }
  });

  it("is a trigger with a single output handle", () => {
    expect(triggerChannelDefinition.category).toBe("trigger");
    expect(triggerChannelDefinition.handles).toEqual({ inputs: [], outputs: ["out"] });
  });
});
