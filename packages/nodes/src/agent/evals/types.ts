/**
 * Eval harness types (AGENTS.md §10). Graded conversations per vertical —
 * the regression net for prompt, retrieval, and tool-schema changes. Never
 * ship a prompt change on vibes.
 */

export interface EvalTool {
  name: string;
  description: string;
  method: "GET" | "POST";
  /** Path served by the harness's local mock server. */
  path: string;
  /** JSON the mock server returns for this tool. */
  response: unknown;
  requireApproval?: boolean;
}

export interface EvalKnowledgeChunk {
  title: string;
  content: string;
}

export interface EvalCase {
  id: string;
  vertical: string;
  name: string;
  systemPrompt: string;
  history?: { role: "user" | "assistant"; content: string }[];
  query: string;
  knowledge?: EvalKnowledgeChunk[];
  tools?: EvalTool[];
  responseFormat?: "text" | "json_schema";
  responseSchema?: string;
  expect: {
    mustInclude?: string[];
    mustNotInclude?: string[];
    mustCallTool?: string;
    mustNotCallTool?: string;
  };
}

export type EvalVerdict = "pass" | "fail" | "skipped";

export interface EvalResult {
  caseId: string;
  vertical: string;
  name: string;
  verdict: EvalVerdict;
  /** Human-readable explanation of unmet expectations. */
  notes: string[];
  /** Tool names the agent actually executed. */
  toolCalls: string[];
  durationMs: number;
}

export interface EvalSummary {
  results: EvalResult[];
  passed: number;
  failed: number;
  skipped: number;
}
