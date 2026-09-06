import { Icon } from "../../../components/dashboard/icons";
import { NewFlowButton } from "../../../components/flows/new-flow-button";
import { API_URL } from "../../../lib/api";

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
  const published = flows?.filter((flow) => flow.publishedVersion !== null).length ?? 0;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 8,
            }}
          >
            <h1 className="page-title" style={{ margin: 0 }}>
              Agents
            </h1>
            {flows !== undefined && flows.length > 0 && (
              <span className="badge badge-accent badge-dotless" style={{ fontSize: 11.5 }}>
                {flows.length} total
              </span>
            )}
          </div>
          <p className="page-subtitle" style={{ margin: 0 }}>
            {published > 0
              ? `${published} of ${flows?.length ?? 0} published and answering customers.`
              : "Design AI support agents on the canvas, then publish them."}
          </p>
        </div>
        <NewFlowButton />
      </div>

      {error !== undefined && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            borderRadius: "var(--radius-lg)",
            background: "var(--err-light)",
            color: "var(--err-strong)",
            fontSize: 13.5,
            fontWeight: 550,
            marginBottom: 20,
          }}
        >
          <Icon name="activity" size={17} />
          <span>
            Could not load agents — {error}. Is the API running (
            <code style={{ background: "transparent", border: "none" }}>pnpm dev --filter api</code>
            )?
          </span>
        </div>
      )}

      {flows !== undefined && flows.length === 0 && (
        <div
          className="card"
          style={{
            textAlign: "center",
            padding: "56px 24px",
            border: "1.5px dashed var(--border-strong)",
            background: "color-mix(in srgb, var(--surface) 55%, transparent)",
            boxShadow: "none",
          }}
        >
          <div
            className="animate-float"
            style={{
              width: 72,
              height: 72,
              margin: "0 auto 18px",
              borderRadius: 22,
              background: "var(--accent-gradient)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              boxShadow: "0 16px 40px -8px var(--accent-glow)",
            }}
          >
            <Icon name="bot" size={32} />
          </div>
          <h3 style={{ fontSize: 17, marginBottom: 6 }}>No agents yet</h3>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: 14,
              maxWidth: 420,
              margin: "0 auto 22px",
            }}
          >
            Create your first support agent — pick a channel trigger, wire up an agent node with a
            model and knowledge, then hit publish.
          </p>
          <div className="flex" style={{ justifyContent: "center", gap: 10 }}>
            <NewFlowButton />
          </div>
        </div>
      )}

      {flows !== undefined && flows.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 14,
          }}
        >
          {flows.map((flow, index) => {
            const published = flow.publishedVersion !== null;
            return (
              <a
                key={flow.flowId}
                href={`/flows/${flow.flowId}`}
                className="card-link"
                style={{
                  padding: 0,
                  overflow: "hidden",
                  animation: `riseIn 480ms var(--ease-spring) both`,
                  animationDelay: `${index * 55}ms`,
                }}
              >
                <div
                  style={{
                    height: 4,
                    background: published
                      ? "linear-gradient(90deg, var(--ok), #34d399)"
                      : "linear-gradient(90deg, var(--accent), #a5b4fc)",
                    opacity: 0.9,
                  }}
                />
                <div style={{ padding: "18px 20px" }}>
                  <div className="flex items-center" style={{ gap: 12, marginBottom: 14 }}>
                    <div
                      className="tile-icon"
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 14,
                        background: published ? "var(--ok-light)" : "var(--accent-100)",
                        color: published ? "var(--ok-strong)" : "var(--accent)",
                      }}
                    >
                      <Icon name="bot" size={21} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        className="truncate"
                        style={{ fontWeight: 680, fontSize: 15, color: "var(--text)" }}
                      >
                        {flow.name}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 1 }}>
                        Updated {formatDate(flow.updatedAt)}
                      </div>
                    </div>
                    {published ? (
                      <span
                        className="badge badge-ok"
                        style={{ fontSize: 11, padding: "3px 10px" }}
                      >
                        Live v{flow.publishedVersion}
                      </span>
                    ) : (
                      <span
                        className="badge badge-warn"
                        style={{ fontSize: 11, padding: "3px 10px" }}
                      >
                        Draft
                      </span>
                    )}
                  </div>

                  <div
                    className="flex items-center justify-between"
                    style={{
                      borderTop: "1px solid var(--border-light)",
                      paddingTop: 12,
                      fontSize: 12.5,
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span className="flex items-center" style={{ gap: 6 }}>
                      <Icon name="activity" size={14} style={{ color: "var(--text-muted)" }} />
                      {flow.runCount} run{flow.runCount === 1 ? "" : "s"}
                    </span>
                    <span className="flex items-center" style={{ gap: 4, fontWeight: 600 }}>
                      Open canvas
                      <Icon name="arrowRight" size={14} />
                    </span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
