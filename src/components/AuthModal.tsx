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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[92%] max-w-sm rounded bg-white p-4 shadow-lg">
        <h3 className="text-base font-semibold">Sign in</h3>
        <div className="mt-3 space-y-2">
          <input
            className="w-full rounded border border-gray-300 p-2 text-sm"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full rounded border border-gray-300 p-2 text-sm"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border">Cancel</button>
          <button onClick={submit} disabled={loading} className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
