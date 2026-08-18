"use client";

import { useCallback, useEffect, useState } from "react";

interface User {
  id: string;
  email: string;
  name: string;
  totpEnabled: boolean;
  passkeyEnabled: boolean;
}

interface Passkey {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function SecuritySettingsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);

  // TOTP state
  const [totpSetup, setTotpSetup] = useState(false);
  const [totpSecret, setTotpSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);

  // Passkey state
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [meRes, pkRes] = await Promise.all([
        fetch("/api/auth/me", { credentials: "same-origin" }),
        fetch("/api/auth/passkeys", { credentials: "same-origin" }),
      ]);
      if (meRes.ok) {
        const data = (await meRes.json()) as { user: User };
        setUser(data.user);
      }
      if (pkRes.ok) {
        const data = (await pkRes.json()) as { passkeys: Passkey[] };
        setPasskeys(data.passkeys);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ─── TOTP Setup ───────────────────────────────────────────────────────

  const startTotpSetup = useCallback(async () => {
    setTotpLoading(true);
    try {
      const res = await fetch("/api/auth/totp/setup", {
        method: "POST",
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = (await res.json()) as { secret: string; uri: string };
        setTotpSecret(data.secret);
        setTotpUri(data.uri);
        setTotpSetup(true);
      }
    } catch {
      setToast({ type: "error", message: "Failed to initialize TOTP setup." });
    } finally {
      setTotpLoading(false);
    }
  }, []);

  const verifyTotp = useCallback(async () => {
    setTotpLoading(true);
    try {
      const res = await fetch("/api/auth/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ code: totpCode }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: { message: string };
      };
      if (data.ok) {
        setToast({ type: "success", message: "Two-factor authentication enabled!" });
        setTotpSetup(false);
        setTotpCode("");
        void loadData();
      } else {
        setToast({ type: "error", message: data.error?.message ?? "Verification failed." });
      }
    } catch {
      setToast({ type: "error", message: "Connection failed." });
    } finally {
      setTotpLoading(false);
    }
  }, [totpCode, loadData]);

  const disableTotp = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/totp/disable", {
        method: "POST",
        credentials: "same-origin",
      });
      if (res.ok) {
        setToast({ type: "success", message: "Two-factor authentication disabled." });
        void loadData();
      }
    } catch {
      setToast({ type: "error", message: "Failed to disable TOTP." });
    }
  }, [loadData]);

  // ─── Passkey Registration ──────────────────────────────────────────────

  const registerPasskey = useCallback(async () => {
    setPasskeyLoading(true);
    try {
      const startRes = await fetch("/api/auth/passkey/register/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: passkeyName || "My Passkey" }),
      });

      if (!startRes.ok) {
        setToast({ type: "error", message: "Failed to start passkey registration." });
        return;
      }

      const options = (await startRes.json()) as {
        challenge: string;
        rp: { name: string; id: string };
        user: { id: string; name: string; displayName: string };
        pubKeyCredParams: Array<{ type: string; alg: number }>;
        excludeCredentials: Array<{ id: string; type: string }>;
        authenticatorSelection: { residentKey: string; userVerification: string };
      };

      // Use browser WebAuthn API
      if (typeof window !== "undefined" && window.navigator?.credentials != null) {
        const rawCred = await navigator.credentials.create({
          publicKey: {
            challenge: Uint8Array.from(atob(options.challenge), (c) => c.charCodeAt(0)),
            rp: options.rp,
            user: {
              id: Uint8Array.from(options.user.id, (c) => c.charCodeAt(0)),
              name: options.user.name,
              displayName: options.user.displayName,
            },
            pubKeyCredParams: options.pubKeyCredParams.map((p) => ({
              type: p.type as PublicKeyCredentialType,
              alg: p.alg,
            })),
            excludeCredentials: options.excludeCredentials.map((c) => ({
              id: Uint8Array.from(atob(c.id), (c) => c.charCodeAt(0)),
              type: c.type as PublicKeyCredentialType,
            })),
            authenticatorSelection: options.authenticatorSelection as AuthenticatorSelectionCriteria,
          },
        });

        if (rawCred) {
          const credential = rawCred as PublicKeyCredential & { response: AuthenticatorAttestationResponse };
          const attResp = credential.response;
          const finishRes = await fetch("/api/auth/passkey/register/finish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              id: credential.id,
              rawId: btoa(String.fromCharCode(...new Uint8Array(new Uint8Array(credential.rawId)))),
              response: {
                attestationObject: btoa(
                  String.fromCharCode(...new Uint8Array(attResp.attestationObject)),
                ),
                clientDataJSON: btoa(
                  String.fromCharCode(...new Uint8Array(attResp.clientDataJSON)),
                ),
              },
              type: credential.type,
              transports: attResp.getTransports?.() ?? [],
            }),
          });

          if (finishRes.ok) {
            setToast({ type: "success", message: "Passkey registered successfully!" });
            setPasskeyName("");
            void loadData();
          } else {
            setToast({ type: "error", message: "Failed to register passkey." });
          }
        }
      } else {
        setToast({ type: "error", message: "WebAuthn is not supported in this browser." });
      }
    } catch {
      setToast({ type: "error", message: "Passkey registration failed." });
    } finally {
      setPasskeyLoading(false);
    }
  }, [passkeyName, loadData]);

  const deletePasskey = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/auth/passkeys/${id}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (res.ok) {
          setToast({ type: "success", message: "Passkey removed." });
          void loadData();
        }
      } catch {
        setToast({ type: "error", message: "Failed to remove passkey." });
      }
    },
    [loadData],
  );

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "48px" }}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up">
      <h1 style={{ marginBottom: "4px" }}>Security</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "32px", fontSize: "14px" }}>
        Manage two-factor authentication and passkeys for your account.
      </p>

      {toast !== null && (
        <div className="toast-container" style={{ position: "relative", top: 0, right: 0, marginBottom: "16px" }}>
          <div className={`toast toast-${toast.type}`}>{toast.type === "success" ? "✓" : "✕"} {toast.message}</div>
        </div>
      )}

      {/* TOTP Section */}
      <div className="settings-section">
        <div className="settings-section-title">Two-Factor Authentication</div>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Authenticator App (TOTP)</div>
              <div className="card-description">
                Use an authenticator app like Google Authenticator, Authy, or 1Password to generate
                login codes.
              </div>
            </div>
            {user?.totpEnabled ? (
              <span className="badge badge-ok">Enabled</span>
            ) : (
              <span className="badge badge-muted">Disabled</span>
            )}
          </div>
          <div className="card-body">
            {totpSetup ? (
              <div className="animate-fade-in-up">
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "480px" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 500, marginBottom: "8px" }}>
                      1. Add this secret to your authenticator app:
                    </div>
                    <div
                      style={{
                        background: "var(--bg)",
                        border: "1px solid var(--border-light)",
                        borderRadius: "var(--radius-sm)",
                        padding: "12px 16px",
                        fontFamily: "monospace",
                        fontSize: "14px",
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                        wordBreak: "break-all",
                      }}
                    >
                      {totpSecret}
                    </div>
                    <button
                      className="btn btn-ghost btn-sm mt-2"
                      onClick={() => {
                        void navigator.clipboard.writeText(totpSecret);
                        setToast({ type: "success", message: "Secret copied!" });
                      }}
                    >
                      Copy secret
                    </button>
                  </div>

                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 500, marginBottom: "8px" }}>
                      2. Scan this QR code (or enter the URI manually):
                    </div>
                    <div className="qr-container">
                      {/* QR code would be rendered here with a library */}
                      <div
                        style={{
                          width: "180px",
                          height: "180px",
                          background: "#fff",
                          borderRadius: "8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "1px solid var(--border-light)",
                        }}
                      >
                        <div style={{ textAlign: "center", padding: "16px" }}>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
                            Scan with authenticator app
                          </div>
                          <div
                            style={{
                              fontSize: "10px",
                              fontFamily: "monospace",
                              wordBreak: "break-all",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {totpUri.slice(0, 60)}…
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 500, marginBottom: "8px" }}>
                      3. Enter the 6-digit code to verify:
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        className="form-input"
                        placeholder="000000"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        maxLength={6}
                        inputMode="numeric"
                        style={{ maxWidth: "160px", textAlign: "center", fontFamily: "monospace", fontSize: "18px", letterSpacing: "0.1em" }}
                      />
                      <button
                        className="btn btn-primary"
                        onClick={verifyTotp}
                        disabled={totpCode.length !== 6 || totpLoading}
                      >
                        {totpLoading ? "Verifying…" : "Verify & Enable"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          setTotpSetup(false);
                          setTotpCode("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                {user?.totpEnabled ? (
                  <div className="flex items-center justify-between" style={{ maxWidth: "480px" }}>
                    <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                      Two-factor authentication is active on your account.
                    </div>
                    <button className="btn btn-danger btn-sm" onClick={disableTotp}>
                      Disable 2FA
                    </button>
                  </div>
                ) : (
                  <div style={{ maxWidth: "480px" }}>
                    <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                      Add an extra layer of security to your account. When enabled, you'll need to
                      enter a code from your authenticator app each time you sign in.
                    </p>
                    <button className="btn btn-primary" onClick={startTotpSetup} disabled={totpLoading}>
                      {totpLoading ? "Setting up…" : "Enable 2FA"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Passkey Section */}
      <div className="settings-section">
        <div className="settings-section-title">Passkeys</div>
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Passkey Authentication</div>
              <div className="card-description">
                Use your device's biometrics (fingerprint, face) or security key to sign in without a
                password.
              </div>
            </div>
            {user?.passkeyEnabled ? (
              <span className="badge badge-ok">Enabled</span>
            ) : (
              <span className="badge badge-muted">Disabled</span>
            )}
          </div>
          <div className="card-body">
            {/* Register new passkey */}
            <div style={{ marginBottom: "20px", maxWidth: "480px" }}>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  className="form-input"
                  placeholder="Passkey name (e.g. My Laptop)"
                  value={passkeyName}
                  onChange={(e) => setPasskeyName(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-primary"
                  onClick={registerPasskey}
                  disabled={passkeyLoading}
                >
                  {passkeyLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="spinner" style={{ borderTopColor: "#fff" }} />
                      Registering…
                    </span>
                  ) : (
                    "Add Passkey"
                  )}
                </button>
              </div>
            </div>

            {/* Existing passkeys */}
            {passkeys.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {passkeys.map((pk) => (
                  <div
                    key={pk.id}
                    className="flex items-center justify-between"
                    style={{
                      padding: "12px 16px",
                      background: "var(--bg)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "8px",
                          background: "var(--accent-light)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "16px",
                        }}
                      >
                        🔑
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: "14px" }}>{pk.label || "Unnamed Passkey"}</div>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                          Created {new Date(pk.createdAt).toLocaleDateString()}
                          {pk.lastUsedAt !== null &&
                            ` · Last used ${new Date(pk.lastUsedAt).toLocaleDateString()}`}
                        </div>
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: "var(--err)" }}
                      onClick={() => void deletePasskey(pk.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: "13px", color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>
                No passkeys registered yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="settings-section">
        <div className="card" style={{ background: "var(--accent-light)", borderColor: "var(--accent-light)" }}>
          <div className="flex items-center gap-3">
            <div style={{ fontSize: "20px" }}>🛡️</div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              <strong>Security tip:</strong> Enable both 2FA and passkeys for maximum account security.
              Passkeys are the most secure option as they are phishing-resistant and don't rely on
              shared secrets.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
