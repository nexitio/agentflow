import { NewFlowButton } from "../../components/flows/new-flow-button";
import { API_URL } from "../../lib/api";

export const dynamic = "force-dynamic";

interface FlowSummary {
  flowId: string;
  name: string;
  draftVersion: number | null;
  publishedVersion: number | null;
  publishedAt: string | null;
  updatedAt: string;
  runCount: number;
}

interface LoadResult {
  flows?: FlowSummary[];
  error?: string;
}

async function loadFlows(): Promise<LoadResult> {
  try {
    const response = await fetch(`${API_URL}/api/flows`, { cache: "no-store" });
    if (!response.ok) {
      return { error: `API returned ${response.status}` };
    }
    const body = (await response.json()) as { flows: FlowSummary[] };
    return { flows: body.flows };
  } catch {
    return { error: "API unreachable" };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function FlowsPage() {
  const { flows, error } = await loadFlows();

  return (
    <main style={{ maxWidth: "56rem", margin: "0 auto", padding: "2.5rem 1.5rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Flows</h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)" }}>
            Build and publish AI support agents.
          </p>
        </div>
        <NewFlowButton />
      </div>

      {error !== undefined && (
        <div className="card" style={{ color: "var(--err)" }}>
          Could not load flows — {error}. Is the API running (<code>pnpm dev --filter api</code>)?
        </div>
      )}

      {flows !== undefined && flows.length === 0 && (
        <div
          className="card"
          style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--muted)" }}
        >
          <p style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No flows yet.</p>
          <p style={{ margin: 0 }}>Create your first agent with the button above.</p>
        </div>
      )}

      {flows !== undefined && flows.length > 0 && (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {flows.map((flow) => (
            <a key={flow.flowId} href={`/flows/${flow.flowId}`} style={{ textDecoration: "none" }}>
              <div className="card" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--text)" }}>{flow.name}</div>
                  <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>
                    {flow.runCount} run{flow.runCount === 1 ? "" : "s"} · updated{" "}
                    {formatDate(flow.updatedAt)}
                  </div>
                </div>
                {flow.publishedVersion !== null ? (
                  <span className="badge ok">published v{flow.publishedVersion}</span>
                ) : (
                  <span className="badge warn">draft</span>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
