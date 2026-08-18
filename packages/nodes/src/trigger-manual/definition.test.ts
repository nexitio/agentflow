import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { triggerManualDefinition, triggerManualParamsSchema } from "./definition";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/params.json", import.meta.url)), "utf8"),
) as unknown;

describe("trigger-manual", () => {
  it("round-trips its params (serialize → deserialize → validate)", () => {
    const parsed = triggerManualParamsSchema.parse(JSON.parse(JSON.stringify(fixture)));
    expect(parsed).toEqual(fixture);
  });

  it("defaults are valid params", () => {
    expect(
      triggerManualParamsSchema.safeParse(triggerManualDefinition.paramDefaults()).success,
    ).toBe(true);
  });

  it("is a trigger with a single output handle", () => {
    expect(triggerManualDefinition.category).toBe("trigger");
    expect(triggerManualDefinition.handles).toEqual({ inputs: [], outputs: ["out"] });
  });
});
