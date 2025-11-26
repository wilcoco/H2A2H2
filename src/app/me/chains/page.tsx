"use client";

import { useEffect, useState } from "react";

export default function MyChainsPage() {
  const [user, setUser] = useState<{ email: string; name?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Array<{ rootId: string; question?: string; myNodes: number; myRels: number; firstCreatedAt?: string }>>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ user: null }));
        if (!active) return;
        if (me?.user?.email) setUser({ email: me.user.email as string, name: me.user.name });
      } catch {}
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!user) return;
        setLoading(true); setError(null);
        const r = await fetch(`/api/qa/chains/my?limit=100`, { cache: "no-store" });
        const j = await r.json().catch(() => ({ items: [] }));
        const arr = Array.isArray(j?.items) ? j.items as Array<{ rootId: string; question?: string; myNodes: number; myRels: number; firstCreatedAt?: string }> : [];
        if (active) setItems(arr);
      } catch (e: unknown) {
        if (active) setError(e instanceof Error ? e.message : "Failed");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user]);

  async function signIn() {
    try {
      setSigning(true); setError(null);
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }) });
      if (!r.ok) throw new Error("로그인 실패");
      const me = await fetch("/api/auth/me", { cache: "no-store" }).then((x) => x.json());
      if (me?.user?.email) setUser({ email: me.user.email as string, name: me.user.name });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "로그인 실패");
    } finally { setSigning(false); }
  }

  return (
    <div className="min-h-dvh p-4 max-w-4xl mx-auto">
      <h1 className="text-lg font-semibold mb-2">나의 체인</h1>
      {!user ? (
        <div className="rounded border p-3 max-w-sm">
          {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
          <div className="text-sm mb-2">로그인하세요</div>
          <input className="w-full border rounded px-2 py-1 text-sm mb-2" placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} />
          <input className="w-full border rounded px-2 py-1 text-sm mb-2" placeholder="Name (optional)" value={name} onChange={(e)=>setName(e.target.value)} />
          <button className="text-xs px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={signing || !email.trim()} onClick={() => void signIn()}>{signing ? "Signing..." : "Sign in"}</button>
        </div>
      ) : (
        <div className="rounded border p-3">
          <div className="text-xs text-gray-600 mb-2">{user.name || user.email}</div>
          {loading ? (
            <div className="text-sm text-gray-600">불러오는 중…</div>
          ) : error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-gray-600">아직 내가 만든 또는 참여한 체인이 없습니다.</div>
          ) : (
            <ul className="divide-y">
              {items.map((it) => (
                <li key={it.rootId} className="py-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium truncate max-w-[60ch]">{it.question || it.rootId}</div>
                    <div className="text-[11px] text-gray-600">노드 {it.myNodes} · 관계 {it.myRels}{it.firstCreatedAt ? ` · 시작 ${new Date(it.firstCreatedAt).toLocaleString()}` : ""}</div>
                  </div>
                  <a className="text-xs px-2 py-1 rounded border" href={`/?qa=${encodeURIComponent(it.rootId)}`}>열기</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
