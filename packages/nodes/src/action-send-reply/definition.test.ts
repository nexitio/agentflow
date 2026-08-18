import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { actionSendReplyDefinition, actionSendReplyParamsSchema } from "./definition";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/params.json", import.meta.url)), "utf8"),
) as unknown;

describe("action-send-reply", () => {
  it("round-trips its params (serialize → deserialize → validate)", () => {
    const parsed = actionSendReplyParamsSchema.parse(JSON.parse(JSON.stringify(fixture)));
    expect(parsed).toEqual(fixture);
  });

  it("defaults are valid params", () => {
    expect(
      actionSendReplyParamsSchema.safeParse(actionSendReplyDefinition.paramDefaults()).success,
    ).toBe(true);
  });

  it("is an action with an input and an output", () => {
    expect(actionSendReplyDefinition.category).toBe("action");
    expect(actionSendReplyDefinition.handles).toEqual({ inputs: ["in"], outputs: ["out"] });
  });
});
