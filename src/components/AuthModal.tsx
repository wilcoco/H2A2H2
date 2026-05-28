"use client";

import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onSignedIn: (user: { email: string; name?: string }) => void;
};

export default function AuthModal({ open, onClose, onSignedIn }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Login failed");
      const me = await fetch("/api/auth/me").then((r) => r.json()).catch(() => ({ user: null }));
      if (me?.user?.email) {
        onSignedIn({ email: me.user.email as string, name: me.user.name });
        onClose();
      } else {
        throw new Error("Unable to load session");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-[92%] max-w-sm rounded-[var(--radius-lg)] bg-[color:var(--bg-elevated)] text-[color:var(--text-normal)] p-4 shadow-2xl border border-[color:var(--border)]">
        <h3 className="text-base font-semibold">Sign in</h3>
        <div className="mt-3 space-y-2">
          <input
            className="w-full rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--bg-primary)] p-2 text-sm focus:outline-none focus:border-[color:var(--accent)]"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--bg-primary)] p-2 text-sm focus:outline-none focus:border-[color:var(--accent)]"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && <div className="mt-2 text-xs text-[color:var(--danger)]">{error}</div>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-[var(--radius-md)] border border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]">Cancel</button>
          <button onClick={submit} disabled={loading} className="text-sm px-3 py-1.5 rounded-[var(--radius-md)] bg-[color:var(--accent)] text-[color:var(--accent-fg)] hover:bg-[color:var(--accent-hover)] disabled:opacity-50">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
