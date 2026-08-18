import type { NodeMigrations } from "../types";

/**
 * v1 (2025) used { field, operator, value }; v2 (2026) uses
 * { path, op, value, caseSensitive }. Old flows upgrade on load and keep
 * executing forever (AGENTS.md §4.1).
 */
export const logicConditionMigrations: NodeMigrations = {
  1: (params) => {
    const legacy = params as { field?: unknown; operator?: unknown; value?: unknown };
    const op =
      legacy.operator === "equals"
        ? "equals"
        : legacy.operator === "not-equals"
          ? "not-equals"
          : "contains";
    return {
      path: typeof legacy.field === "string" ? legacy.field : "text",
      op,
      value: typeof legacy.value === "string" ? legacy.value : "",
      caseSensitive: false,
    };
  },
};
