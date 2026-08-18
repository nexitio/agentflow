import { FlowEditor } from "../../../components/canvas/flow-editor";
import { API_URL } from "../../../lib/api";

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
      <main style={{ maxWidth: "40rem", margin: "0 auto", padding: "2.5rem 1.5rem" }}>
        <div className="card">
          <p style={{ color: "var(--err)", margin: 0 }}>
            Could not load this flow — {error}. Is the API running (
            <code>pnpm dev --filter api</code>)?
          </p>
          <p style={{ margin: "0.75rem 0 0" }}>
            <a href="/flows">← Back to flows</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <FlowEditor flowId={flowId} initialName={draft.flow.name} initialFlow={draft.flow.flowJson} />
  );
}
