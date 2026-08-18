"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

function applyStoredTheme() {
  if (typeof window === "undefined") return;
  const stored = localStorage.getItem("agentflow-theme");
  const theme = stored === "dark" ? "dark" : stored === "light" ? "light" : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");

  useEffect(() => {
    applyStoredTheme();
  }, []);
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");

  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);

      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            ...(requiresTotp ? { totpCode } : {}),
          }),
          credentials: "same-origin",
        });

        const data = (await response.json()) as {
          error?: { message: string };
          requiresTotp?: boolean;
          user?: { id: string };
        };

        if (data.requiresTotp) {
          setRequiresTotp(true);
          setLoading(false);
          return;
        }

        if (data.error) {
          setError(data.error.message);
          setLoading(false);
          return;
        }

        if (data.user) {
          router.push("/settings");
          router.refresh();
        }
      } catch {
        setError("Connection failed. Is the API running?");
        setLoading(false);
      }
    },
    [email, password, totpCode, requiresTotp, router],
  );

  const handleRegister = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);

      try {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name, password }),
          credentials: "same-origin",
        });

        const data = (await response.json()) as {
          error?: { message: string };
          user?: { id: string };
        };

        if (data.error) {
          setError(data.error.message);
          setLoading(false);
          return;
        }

        if (data.user) {
          router.push("/settings");
          router.refresh();
        }
      } catch {
        setError("Connection failed. Is the API running?");
        setLoading(false);
      }
    },
    [email, name, password, router],
  );

  const handlePasskeyLogin = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      // In a full implementation, this would call the passkey auth endpoint
      // and use navigator.credentials.get() for WebAuthn
      setError("Passkey login is available after initial setup.");
    } catch {
      setError("Passkey authentication failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-logo">A</div>
          <h1 className="login-title">Welcome to AgentFlow</h1>
          <p className="login-subtitle">
            {isRegister
              ? "Create your admin account to get started"
              : "Sign in to manage your AI agents"}
          </p>

          {error !== null && (
            <div
              style={{
                background: "var(--err-light)",
                color: "var(--err)",
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                fontSize: "13px",
                marginBottom: "16px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}

          {!isRegister ? (
            <form className="login-form" onSubmit={handleLogin}>
              <div className="form-group">
                <label className="form-label" htmlFor="email">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  className="form-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="email"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="form-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              {requiresTotp && (
                <div className="form-group animate-fade-in">
                  <label className="form-label" htmlFor="totp">
                    Authenticator Code
                  </label>
                  <input
                    id="totp"
                    type="text"
                    className="form-input"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                    autoFocus
                    maxLength={6}
                    pattern="[0-9]{6}"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                  <span className="form-hint">Enter the 6-digit code from your authenticator app</span>
                </div>
              )}

              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="spinner" style={{ borderTopColor: "#fff" }} />
                    Signing in…
                  </span>
                ) : (
                  "Sign in"
                )}
              </button>

              <div className="login-divider">or</div>

              <button
                type="button"
                className="login-passkey-btn"
                onClick={handlePasskeyLogin}
                disabled={loading}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a4 4 0 0 0-4 4v2a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Z" />
                  <path d="M16 10v2a4 4 0 0 1-8 0v-2" />
                  <circle cx="12" cy="16" r="1" />
                  <path d="M12 18v4" />
                </svg>
                Sign in with Passkey
              </button>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleRegister}>
              <div className="form-group">
                <label className="form-label" htmlFor="reg-name">
                  Full name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  className="form-input"
                  placeholder="Jane Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  autoComplete="name"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="reg-email">
                  Email address
                </label>
                <input
                  id="reg-email"
                  type="email"
                  className="form-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="reg-password">
                  Password
                </label>
                <input
                  id="reg-password"
                  type="password"
                  className="form-input"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>

              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="spinner" style={{ borderTopColor: "#fff" }} />
                    Creating account…
                  </span>
                ) : (
                  "Create Account"
                )}
              </button>
            </form>
          )}

          <div className="login-link">
            {isRegister ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent)",
                    fontWeight: 500,
                    cursor: "pointer",
                    fontSize: "13px",
                    padding: 0,
                  }}
                  onClick={() => {
                    setIsRegister(false);
                    setError(null);
                  }}
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                First time?{" "}
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent)",
                    fontWeight: 500,
                    cursor: "pointer",
                    fontSize: "13px",
                    padding: 0,
                  }}
                  onClick={() => {
                    setIsRegister(true);
                    setError(null);
                  }}
                >
                  Create admin account
                </button>
              </>
            )}
          </div>
        </div>

        <p
          style={{
            textAlign: "center",
            marginTop: "16px",
            fontSize: "12px",
            color: "var(--text-muted)",
          }}
        >
          Self-hosted · Your data stays on your server
        </p>
      </div>
    </div>
  );
}
