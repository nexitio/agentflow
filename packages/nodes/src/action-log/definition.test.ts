import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { actionLogDefinition, actionLogParamsSchema } from "./definition";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/params.json", import.meta.url)), "utf8"),
) as unknown;

describe("action-log", () => {
  it("round-trips its params", () => {
    const parsed = actionLogParamsSchema.parse(JSON.parse(JSON.stringify(fixture)));
    expect(parsed).toEqual(fixture);
  });

  it("defaults are valid params", () => {
    expect(actionLogParamsSchema.safeParse(actionLogDefinition.paramDefaults()).success).toBe(true);
  });
});
