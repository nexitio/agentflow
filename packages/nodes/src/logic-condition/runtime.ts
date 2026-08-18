import type { NodeRuntime } from "../types";
import type { logicConditionParamsSchema } from "./definition";

function resolvePath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function compare(
  target: unknown,
  op: "contains" | "equals" | "not-equals",
  value: string,
  caseSensitive: boolean,
): boolean {
  const normalize = (input: string) => (caseSensitive ? input : input.toLowerCase());
  const haystack = normalize(String(target ?? ""));
  const needle = normalize(value);
  switch (op) {
    case "contains":
      return haystack.includes(needle);
    case "equals":
      return haystack === needle;
    case "not-equals":
      return haystack !== needle;
  }
}

export const logicConditionRuntime: NodeRuntime<typeof logicConditionParamsSchema> = {
  type: "logic-condition",
  typeVersion: 2,
  async execute(ctx, params) {
    const target = resolvePath(ctx.inputs.in ?? ctx.input, params.path);
    const matched = compare(target, params.op, params.value, params.caseSensitive);
    return {
      type: "success",
      branch: matched ? "true" : "false",
      output: { branch: matched ? "true" : "false", matched, target },
    };
  },
};
