"use client";

import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (http, permissions) — the URL stays visible to copy by hand.
      setCopied(false);
    }
  }

  return (
    <button type="button" onClick={() => void copy()} aria-label="Copy to clipboard">
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
