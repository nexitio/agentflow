"use client";

import { useCallback, useState } from "react";
import { useTheme } from "../../../lib/theme";

export default function AppearanceSettingsPage() {
  const { theme, setTheme } = useTheme();
  const [accentColor, setAccentColor] = useState("#6366f1");
  const [brandName, setBrandName] = useState("AgentFlow");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // In a full implementation, this would save to the settings API
      await new Promise((r) => setTimeout(r, 500));
      setToast({ type: "success", message: "Appearance settings saved." });
    } catch {
      setToast({ type: "error", message: "Failed to save." });
    } finally {
      setSaving(false);
    }
  }, []);

  const ACCENT_COLORS = [
    { name: "Indigo", value: "#6366f1" },
    { name: "Blue", value: "#3b82f6" },
    { name: "Purple", value: "#8b5cf6" },
    { name: "Pink", value: "#ec4899" },
    { name: "Red", value: "#ef4444" },
    { name: "Orange", value: "#f97316" },
    { name: "Green", value: "#10b981" },
    { name: "Teal", value: "#14b8a6" },
  ];

  return (
    <div className="animate-fade-in-up">
      <h1 style={{ marginBottom: "4px" }}>Appearance</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "32px", fontSize: "14px" }}>
        Customize the look and feel of your workspace.
      </p>

      {toast !== null && (
        <div className="toast-container" style={{ position: "relative", top: 0, right: 0, marginBottom: "16px" }}>
          <div className={`toast toast-${toast.type}`}>{toast.type === "success" ? "✓" : "✕"} {toast.message}</div>
        </div>
      )}

      {/* Theme */}
      <div className="settings-section">
        <div className="settings-section-title">Theme</div>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Color Scheme</div>
              <div className="card-description">Choose your preferred color scheme</div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              {([
                { value: "light" as const, label: "Light", bg: "#f8f9fc", fg: "#1a1d2e", border: "#e5e7ee" },
                { value: "dark" as const, label: "Dark", bg: "#1a1a2e", fg: "#e2e8f0", border: "#2d2d44" },
                { value: "system" as const, label: "Auto", bg: "linear-gradient(135deg, #f8f9fc 50%, #1a1a2e 50%)", fg: "#6b7085", border: "#e5e7ee" },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  style={{
                    width: "120px",
                    padding: "0",
                    border: `2px solid ${theme === opt.value ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: "var(--radius)",
                    overflow: "hidden",
                    transition: "all var(--transition-fast)",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      height: "64px",
                      background: opt.bg,
                      borderBottom: `1px solid ${opt.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div
                      style={{
                        width: "40px",
                        height: "20px",
                        background: opt.fg,
                        borderRadius: "4px",
                        opacity: 0.3,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      padding: "8px",
                      fontSize: "12px",
                      fontWeight: 500,
                      background: "var(--surface)",
                      color: theme === opt.value ? "var(--accent)" : "var(--text)",
                    }}
                  >
                    {opt.label}
                    {theme === opt.value && " ✓"}
                  </div>
                </button>
              ))}
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "12px" }}>
              {theme === "system"
                ? "Following your system preference."
                : theme === "dark"
                  ? "Dark mode is active."
                  : "Light mode is active."}
            </div>
          </div>
        </div>
      </div>

      {/* Accent Color */}
      <div className="settings-section">
        <div className="settings-section-title">Accent Color</div>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Brand Color</div>
              <div className="card-description">Primary color used throughout the interface</div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setAccentColor(color.value)}
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    background: color.value,
                    border: accentColor === color.value ? "3px solid var(--text)" : "3px solid transparent",
                    boxShadow: accentColor === color.value ? `0 0 0 2px var(--surface), 0 0 0 4px ${color.value}` : "none",
                    transition: "all var(--transition-fast)",
                    cursor: "pointer",
                  }}
                  title={color.name}
                />
              ))}
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  border: "2px dashed var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  fontSize: "16px",
                  color: "var(--text-muted)",
                }}
                title="Custom color"
              >
                +
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  background: accentColor,
                  boxShadow: `0 2px 8px ${accentColor}40`,
                }}
              />
              <input
                type="text"
                className="form-input"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                style={{ maxWidth: "140px", fontFamily: "monospace" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Branding */}
      <div className="settings-section">
        <div className="settings-section-title">Branding</div>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Brand Identity</div>
              <div className="card-description">Customize how your workspace appears</div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "480px" }}>
              <div className="form-group">
                <label className="form-label">Workspace Display Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="My Company"
                />
                <span className="form-hint">
                  Shown in the sidebar header and login page
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Logo</label>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                  }}
                >
                  <div
                    style={{
                      width: "64px",
                      height: "64px",
                      borderRadius: "16px",
                      background: `linear-gradient(135deg, ${accentColor}80, ${accentColor})`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "28px",
                      fontWeight: 700,
                      color: "#fff",
                      boxShadow: `0 4px 12px ${accentColor}30`,
                    }}
                  >
                    {brandName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <button className="btn btn-secondary btn-sm">Upload Logo</button>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                      Recommended: 256×256px, PNG or SVG
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Widget Preview */}
      <div className="settings-section">
        <div className="settings-section-title">Widget Preview</div>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Chat Widget</div>
              <div className="card-description">Preview how the embedded widget will look</div>
            </div>
          </div>
          <div className="card-body">
            <div
              style={{
                background: "var(--bg)",
                borderRadius: "var(--radius)",
                padding: "24px",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              {/* Widget bubble preview */}
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    width: "60px",
                    height: "60px",
                    borderRadius: "50%",
                    background: accentColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: `0 4px 16px ${accentColor}40`,
                    cursor: "pointer",
                    transition: "transform var(--transition-fast)",
                  }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                {/* Tooltip */}
                <div
                  style={{
                    position: "absolute",
                    bottom: "70px",
                    right: "0",
                    background: "var(--surface)",
                    borderRadius: "var(--radius)",
                    boxShadow: "var(--shadow-lg)",
                    padding: "12px 16px",
                    width: "220px",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>
                    {brandName}
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                    Hi there! How can we help you today?
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
        <button className="btn btn-secondary">Reset</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? (
            <span className="flex items-center gap-2">
              <span className="spinner" style={{ borderTopColor: "#fff" }} />
              Saving…
            </span>
          ) : (
            "Save Appearance"
          )}
        </button>
      </div>
    </div>
  );
}
