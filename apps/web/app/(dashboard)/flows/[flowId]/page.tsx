import Link from "next/link";

import { FlowEditor } from "../../../../components/canvas/flow-editor";
import { API_URL } from "../../../../lib/api";

export const dynamic = "force-dynamic";

interface DraftResponse {
  flow: {
    name: string;
    flowJson: unknown;
  };
}

export default async function EditorPage({ params }: { params: Promise<{ flowId: string }> }) {
  const { flowId } = await params;

  let draft: DraftResponse | undefined;
  let error: string | undefined;
  try {
    const response = await fetch(`${API_URL}/api/flows/${flowId}`, { cache: "no-store" });
    if (!response.ok) {
      error = `API returned ${response.status}`;
    } else {
      draft = (await response.json()) as DraftResponse;
    }
  } catch {
    error = "API unreachable";
  }

  if (error !== undefined || draft === undefined) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <div className="card" style={{ padding: "28px 32px", maxWidth: 480 }}>
          <p style={{ color: "var(--err-strong)", margin: 0, fontWeight: 600 }}>
            Could not load this flow — {error}. Is the API running (
            <code>pnpm dev --filter api</code>)?
          </p>
          <p style={{ margin: "1rem 0 0" }}>
            <Link href="/flows">← Back to agents</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <FlowEditor flowId={flowId} initialName={draft.flow.name} initialFlow={draft.flow.flowJson} />
  );
}
