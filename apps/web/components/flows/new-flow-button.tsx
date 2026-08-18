"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch } from "../../lib/api";

export function NewFlowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function createFlow() {
    setBusy(true);
    try {
      const body = await apiFetch<{ flow: { flowId: string } }>("/api/flows", {
        method: "POST",
        body: JSON.stringify({ name: "Untitled flow" }),
      });
      router.push(`/flows/${body.flow.flowId}`);
    } catch (error) {
      console.error(error);
      setBusy(false);
    }
  }

  return (
    <button type="button" className="primary" onClick={() => void createFlow()} disabled={busy}>
      {busy ? "Creating…" : "＋ New flow"}
    </button>
  );
}
