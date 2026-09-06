"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch } from "../../lib/api";
import { Icon } from "../dashboard/icons";

export function NewFlowButton({ label = "New agent" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function createFlow() {
    setBusy(true);
    try {
      const body = await apiFetch<{ flow: { flowId: string } }>("/api/flows", {
        method: "POST",
        body: JSON.stringify({ name: "Untitled agent" }),
      });
      router.push(`/flows/${body.flow.flowId}`);
    } catch (error) {
      console.error(error);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-primary btn-lg"
      onClick={() => void createFlow()}
      disabled={busy}
    >
      {busy ? (
        <span
          className="spinner"
          style={{
            width: 15,
            height: 15,
            borderColor: "rgb(255 255 255 / 0.4)",
            borderTopColor: "#fff",
          }}
        />
      ) : (
        <Icon name="plus" size={16} />
      )}
      {busy ? "Creating…" : label}
    </button>
  );
}
