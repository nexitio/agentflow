import { describe, expect, it } from "vitest";

import { logicConditionMigrations } from "./migrations";

describe("logic-condition migrations", () => {
  it("upgrades v1 params to v2", () => {
    const upgrade = logicConditionMigrations[1];
    expect(upgrade).toBeDefined();
    const upgraded = upgrade?.({
      field: "text",
      operator: "contains",
      value: "refund",
    });
    expect(upgraded).toEqual({
      path: "text",
      op: "contains",
      value: "refund",
      caseSensitive: false,
    });
  });

  it("maps equals and not-equals operators", () => {
    const upgrade = logicConditionMigrations[1];
    expect(upgrade?.({ field: "status", operator: "equals", value: "open" })).toMatchObject({
      path: "status",
      op: "equals",
    });
    expect(upgrade?.({ field: "status", operator: "not-equals", value: "open" })).toMatchObject({
      op: "not-equals",
    });
  });

  it("defaults missing fields", () => {
    const upgrade = logicConditionMigrations[1];
    expect(upgrade?.({ operator: "contains" })).toEqual({
      path: "text",
      op: "contains",
      value: "",
      caseSensitive: false,
    });
  });
});
