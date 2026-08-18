import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { agentDefinition, agentParamsSchema } from "./definition";
import {
  agentKnowledgeParamsSchema,
  agentMemoryParamsSchema,
  agentModelParamsSchema,
  agentToolHttpParamsSchema,
} from "./sub-nodes";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/params.json", import.meta.url)), "utf8"),
) as unknown;

describe("agent", () => {
  it("round-trips its params", () => {
    const parsed = agentParamsSchema.parse(JSON.parse(JSON.stringify(fixture)));
    expect(parsed).toEqual(fixture);
  });

  it("defaults are valid params", () => {
    expect(agentParamsSchema.safeParse(agentDefinition.paramDefaults()).success).toBe(true);
  });

  it("is an agent category with sub-node ports", () => {
    expect(agentDefinition.category).toBe("agent");
  });
});

describe("agent sub-nodes", () => {
  it("validates model params", () => {
    expect(agentModelParamsSchema.safeParse({ model: "gpt-4o" }).success).toBe(true);
    expect(agentModelParamsSchema.safeParse({}).success).toBe(false);
  });

  it("validates memory params with a bounded window", () => {
    expect(agentMemoryParamsSchema.safeParse({}).success).toBe(true);
    expect(agentMemoryParamsSchema.safeParse({ windowSize: 100 }).success).toBe(false);
  });

  it("validates knowledge params", () => {
    expect(agentKnowledgeParamsSchema.safeParse({ collection: "docs", maxChunks: 4 }).success).toBe(
      true,
    );
  });

  it("requires an absolute URL for HTTP tools", () => {
    expect(
      agentToolHttpParamsSchema.safeParse({
        name: "lookup",
        description: "look up an order",
        method: "GET",
        url: "https://api.example.com/orders/{{orderId}}",
      }).success,
    ).toBe(true);
    expect(
      agentToolHttpParamsSchema.safeParse({
        name: "lookup",
        description: "look up an order",
        method: "GET",
        url: "not-a-url",
      }).success,
    ).toBe(false);
  });
});
