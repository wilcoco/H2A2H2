"use client";

import { useEffect, useRef, useState } from "react";
import type { QAEntry } from "@/types/graph";

type Props = {
  qaId?: string;
};

export default function RightRelations({ qaId }: Props) {
  const [relType, setRelType] = useState<string>("follows_from");
  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<QAEntry[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edges, setEdges] = useState<Array<{ sourceId: string; targetId: string; type: string; synthetic?: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { setError(null); }, [qaId]);

  useEffect(() => {
    const t = setTimeout(() => { void search(query); }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function search(q: string) {
    const text = q.trim();
    if (!text) { setResults([]); abortRef.current?.abort(); return; }
    try {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const res = await fetch("/api/qa/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: text, limit: 10, strict: true }), cache: "no-store", signal: controller.signal });
      const j = await res.json().catch(() => ({ items: [] }));
      const its: QAEntry[] = Array.isArray(j?.items) ? (j.items as QAEntry[]) : [];
      setResults(its);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
    }
  }

  async function connect() {
    if (!qaId || !targetId || !relType) return;
    try {
      setBusy(true); setError(null);
      const res = await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: qaId, targetId, type: relType, weight: 1 }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Connect failed");
      }
      setTargetId(null); setQuery(""); setResults([]);
      await refreshEdges();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function refreshEdges() {
    if (!qaId) { setEdges([]); return; }
    try {
      const r = await fetch(`/api/qa/map?qaId=${encodeURIComponent(qaId)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({ nodes: [], edges: [] }));
      const es: Array<{ sourceId: string; targetId: string; type: string; synthetic?: boolean }> = Array.isArray(j?.edges) ? j.edges : [];
      setEdges(es.filter((e) => e.sourceId === qaId || e.targetId === qaId).slice(0, 20));
    } catch {}
  }

  useEffect(() => { void refreshEdges(); }, [qaId]);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">질문 간 관계 편집</div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex items-center gap-2 flex-wrap">
        <select className="text-xs border rounded px-2 py-1" value={relType} onChange={(e) => setRelType(e.target.value)}>
          <option value="follows_from">follows_from</option>
          <option value="refines">refines</option>
          <option value="clarifies">clarifies</option>
          <option value="depends_on">depends_on</option>
          <option value="alternative">alternative</option>
        </select>
        <input
          className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
          placeholder="연결할 기존 질문 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if ((e as any).isComposing) return; if (e.key === "Enter") e.preventDefault(); }}
          id="rel-search-right"
          name="rel-search-right"
        />
        <button className="text-xs px-3 py-2 rounded border disabled:opacity-50" disabled={!qaId || !targetId || busy} onClick={() => void connect()}>{busy ? "Connecting..." : "Connect"}</button>
      </div>
      {results.length > 0 && (
        <ul className="mt-1 space-y-1 max-h-40 overflow-auto">
          {results.map((it) => (
            <li key={it.id} className={`p-2 rounded border text-xs flex items-center justify-between gap-2 ${targetId === it.id ? "bg-gray-50" : ""}`}>
              <div className="min-w-0 truncate">Q: {it.question}</div>
              <button className="text-[11px] px-2 py-1 rounded border shrink-0" onClick={() => setTargetId(it.id)}>{targetId === it.id ? "선택됨" : "선택"}</button>
            </li>
          ))}
        </ul>
      )}
      {edges.length > 0 && (
        <div>
          <div className="text-xs text-gray-600">현재 질문의 기존 연결</div>
          <ul className="text-[11px] space-y-0.5">
            {edges.map((e, i) => (
              <li key={i}>{e.sourceId === qaId ? "→" : "←"} {e.type} {e.sourceId === qaId ? e.targetId : e.sourceId}{e.synthetic ? " (auto)" : ""}</li>
            ))}
          </ul>
        </div>
      )}
      {!qaId && <div className="text-[11px] text-gray-600">먼저 중앙에서 Q&A를 공유해 ID를 생성하세요.</div>}
    </div>
  );
}
