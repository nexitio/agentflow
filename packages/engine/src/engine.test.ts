import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "@agentflow/db/client";
import type { NodeRuntime } from "@agentflow/nodes/types";

import { ValidationError } from "@agentflow/shared/errors";
import { describe, expect, it } from "vitest";

import { executeFlow, upgradeNode } from "./engine";

// Engine unit tests don't open a database — the stub throws if a node (e.g.
// the agent) actually touches it, surfacing wiring mistakes instead of
// silently succeeding. Agent behavior is covered by the node tests + the
// packages/db integration suite.
const dbStub = {
  select: (): never => {
    throw new Error("engine unit tests do not wire a database");
  },
} as unknown as Db;

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/flows/${name}.json`, import.meta.url)), "utf8"),
  ) as unknown;
}

const BASE = {
  workspaceId: "00000000-0000-7000-8000-000000000001",
  channel: "widget" as const,
  db: dbStub,
};

describe("executeFlow — compatibility corpus", () => {
  it("executes the manual → log flow", async () => {
    const result = await executeFlow({ flow: loadFixture("manual-log"), input: {}, ...BASE });
    expect(result.status).toBe("succeeded");
    expect(result.nodeOutputs.t1?.status).toBe("success");
    expect(result.nodeOutputs.a1?.status).toBe("success");
    expect(result.nodeOutputs.a1?.output).toMatchObject({ message: "hello world" });
    expect(result.timings.t1).toBeDefined();
    expect(result.timings.a1).toBeDefined();
    expect(result.tokenUsage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it("routes branches by the condition outcome", async () => {
    const result = await executeFlow({
      flow: loadFixture("manual-condition-log"),
      input: { text: "I want a refund" },
      ...BASE,
    });
    expect(result.status).toBe("succeeded");
    expect(result.nodeOutputs.c1?.branch).toBe("true");
    expect(result.nodeOutputs.l1?.status).toBe("success");
    expect(result.nodeOutputs.l2).toBeUndefined();
  });

  it("takes the false branch when the condition does not match", async () => {
    const result = await executeFlow({
      flow: loadFixture("manual-condition-log"),
      input: { text: "what are your hours?" },
      ...BASE,
    });
    expect(result.nodeOutputs.c1?.branch).toBe("false");
    expect(result.nodeOutputs.l2?.status).toBe("success");
    expect(result.nodeOutputs.l1).toBeUndefined();
  });

  it("loads and executes a legacy flow (condition typeVersion 1) via migration", async () => {
    const result = await executeFlow({
      flow: loadFixture("legacy-condition"),
      input: { text: "where is my refund?" },
      ...BASE,
    });
    // The legacy { field, operator } params must execute with v2 semantics.
    expect(result.status).toBe("succeeded");
    expect(result.nodeOutputs.c1?.branch).toBe("true");
    expect(result.nodeOutputs.l1?.status).toBe("success");
    expect(result.nodeOutputs.l2).toBeUndefined();
  });

  it("records a deliberate agent failure and skips downstream nodes", async () => {
    const result = await executeFlow({
      flow: loadFixture("manual-agent-log"),
      input: { text: "hello" },
      ...BASE,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ code: "CONFIGURATION", nodeId: "a1" });
    expect(result.nodeOutputs.a1?.status).toBe("error");
    // The sub-node is config, not sequence — it must not execute.
    expect(result.nodeOutputs.m1).toBeUndefined();
    expect(result.nodeOutputs.l1).toBeUndefined();
  });
});

describe("executeFlow — engine behavior", () => {
  it("rejects flows with no trigger or multiple triggers", async () => {
    const noTrigger = {
      version: 1,
      nodes: [{ id: "a1", type: "action-log", typeVersion: 1, params: { message: "x" } }],
      edges: [],
    };
    await expect(executeFlow({ flow: noTrigger, input: {}, ...BASE })).rejects.toThrow(
      ValidationError,
    );

    const twoTriggers = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger-manual", typeVersion: 1, params: {} },
        { id: "t2", type: "trigger-manual", typeVersion: 1, params: {} },
      ],
      edges: [],
    };
    await expect(executeFlow({ flow: twoTriggers, input: {}, ...BASE })).rejects.toThrow(
      ValidationError,
    );
  });

  it("fails with a clear error on unknown node types", async () => {
    const flow = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger-manual", typeVersion: 1, params: {} },
        { id: "x1", type: "no-such-node", typeVersion: 1, params: {} },
      ],
      edges: [{ id: "e1", source: "t1", target: "x1" }],
    };
    const result = await executeFlow({ flow, input: {}, ...BASE });
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ code: "CONFIGURATION", nodeId: "x1" });
    expect(result.error?.message).toContain("no-such-node");
  });

  it("terminates on cyclic flows (each node executes once)", async () => {
    const flow = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger-manual", typeVersion: 1, params: {} },
        { id: "l1", type: "action-log", typeVersion: 1, params: { message: "loop" } },
        { id: "l2", type: "action-log", typeVersion: 1, params: { message: "loop" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "l1" },
        { id: "e2", source: "l1", target: "l2" },
        { id: "e3", source: "l2", target: "l1" },
      ],
    };
    const result = await executeFlow({ flow, input: {}, ...BASE });
    expect(result.status).toBe("succeeded");
    expect(result.nodeOutputs.l1?.status).toBe("success");
    expect(result.nodeOutputs.l2?.status).toBe("success");
  });

  it("sums token usage reported by node outcomes", async () => {
    const reportingLog: NodeRuntime = {
      type: "action-log",
      typeVersion: 1,
      async execute() {
        return {
          type: "success",
          output: {},
          tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      },
    };
    const result = await executeFlow({
      flow: loadFixture("manual-log"),
      input: {},
      runtimes: { "action-log": reportingLog },
      ...BASE,
    });
    expect(result.status).toBe("succeeded");
    expect(result.tokenUsage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("fails the run when a node throws (deliberate vs internal)", async () => {
    const throwingLog: NodeRuntime = {
      type: "action-log",
      typeVersion: 1,
      async execute() {
        throw new Error("boom");
      },
    };
    const result = await executeFlow({
      flow: loadFixture("manual-log"),
      input: {},
      runtimes: { "action-log": throwingLog },
      ...BASE,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ code: "INTERNAL", nodeId: "a1", message: "boom" });
  });
});

describe("upgradeNode", () => {
  it("upgrades legacy params to the current version", () => {
    const upgraded = upgradeNode({
      id: "c1",
      type: "logic-condition",
      typeVersion: 1,
      position: { x: 0, y: 0 },
      params: { field: "text", operator: "contains", value: "refund" },
    });
    expect(upgraded.typeVersion).toBe(2);
    expect(upgraded.params).toEqual({
      path: "text",
      op: "contains",
      value: "refund",
      caseSensitive: false,
    });
  });

  it("rejects a flow node newer than this build supports", () => {
    expect(() =>
      upgradeNode({
        id: "c1",
        type: "logic-condition",
        typeVersion: 99,
        position: { x: 0, y: 0 },
        params: {},
      }),
    ).toThrow(ValidationError);
  });
});
