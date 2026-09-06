"use client";

import { useState } from "react";

import { Icon } from "../dashboard/icons";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (http, permissions) — the value stays visible to copy by hand.
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className={`btn ${copied ? "btn-ghost" : "btn-secondary"} btn-sm`}
      onClick={() => void copy()}
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <>
          <Icon name="check" size={14} strokeWidth={2.4} />
          Copied
        </>
      ) : (
        label
      )}
    </button>
  );
}
