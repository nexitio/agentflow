import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { logicConditionDefinition, logicConditionParamsSchema } from "./definition";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/params.json", import.meta.url)), "utf8"),
) as unknown;

describe("logic-condition", () => {
  it("round-trips its params", () => {
    const parsed = logicConditionParamsSchema.parse(JSON.parse(JSON.stringify(fixture)));
    expect(parsed).toEqual(fixture);
  });

  it("defaults are valid params", () => {
    expect(
      logicConditionParamsSchema.safeParse(logicConditionDefinition.paramDefaults()).success,
    ).toBe(true);
  });

  it("branches on true/false output handles", () => {
    expect(logicConditionDefinition.handles.outputs).toEqual(["true", "false"]);
  });
});
