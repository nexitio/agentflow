"use client";

import type { NodeDefinition } from "@agentflow/nodes/types";
import type { z } from "zod";

interface ParamField {
  key: string;
  kind: "string" | "enum" | "number" | "boolean" | "unknown";
  values?: string[];
}

/**
 * The canvas form is generated from the node definition's Zod schema — no
 * hand-written forms (AGENTS.md §5). Field kinds are derived from the schema
 * classes (ZodString → text, ZodEnum → select, ZodNumber → number,
 * ZodBoolean → toggle), unwrapping optional/default wrappers.
 */
function describeField(field: z.ZodType): Omit<ParamField, "key"> {
  const name = field.constructor.name;
  if (name === "ZodOptional" || name === "ZodDefault") {
    // ZodOptional/ZodDefault expose unwrap(); the base type doesn't declare it.
    const unwrap = (field as unknown as { unwrap(): z.ZodType }).unwrap;
    return describeField(unwrap.call(field));
  }
  switch (name) {
    case "ZodEnum":
      return { kind: "enum", values: (field as unknown as { options: string[] }).options };
    case "ZodString":
      return { kind: "string" };
    case "ZodNumber":
      return { kind: "number" };
    case "ZodBoolean":
      return { kind: "boolean" };
    default:
      return { kind: "unknown" };
  }
}

function fieldsOf(definition: NodeDefinition): ParamField[] {
  const shape = (definition.paramSchema as unknown as { shape?: Record<string, z.ZodType> }).shape;
  if (shape === undefined) {
    return [];
  }
  return Object.entries(shape).map(([key, field]) => ({ key, ...describeField(field) }));
}

export function ParamForm({
  definition,
  values,
  onChange,
}: {
  definition: NodeDefinition;
  values: Record<string, unknown>;
  onChange(key: string, value: unknown): void;
}) {
  const fields = fieldsOf(definition);
  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {fields.map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          value={values[field.key]}
          onValue={(v) => onChange(field.key, v)}
        />
      ))}
    </div>
  );
}

function FieldRow({
  field,
  value,
  onValue,
}: {
  field: ParamField;
  value: unknown;
  onValue(value: unknown): void;
}) {
  if (field.kind === "unknown") {
    return (
      <div>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted)" }}>
          {field.key}
        </span>
        <code style={{ fontSize: "12px", color: "var(--muted)", display: "block" }}>
          unsupported field type
        </code>
      </div>
    );
  }
  return (
    <label htmlFor={`param-${field.key}`} style={{ display: "block" }}>
      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted)" }}>{field.key}</span>
      <FieldInput id={`param-${field.key}`} field={field} value={value} onValue={onValue} />
    </label>
  );
}

function FieldInput({
  id,
  field,
  value,
  onValue,
}: {
  id: string;
  field: ParamField;
  value: unknown;
  onValue(value: unknown): void;
}) {
  switch (field.kind) {
    case "enum":
      return (
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(event) => onValue(event.target.value)}
          style={{ width: "100%", marginTop: "2px" }}
        >
          {field.values?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "number":
      return (
        <input
          id={id}
          type="number"
          step="any"
          value={value === undefined || value === "" ? "" : String(value)}
          onChange={(event) =>
            onValue(event.target.value === "" ? undefined : Number(event.target.value))
          }
          style={{ width: "100%", marginTop: "2px" }}
        />
      );
    case "boolean":
      return (
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onValue(event.target.checked)}
          style={{ marginTop: "2px" }}
        />
      );
    default:
      return (
        <textarea
          id={id}
          rows={field.key === "systemPrompt" ? 3 : 1}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onValue(event.target.value)}
          style={{ width: "100%", marginTop: "2px", resize: "vertical" }}
        />
      );
  }
}
