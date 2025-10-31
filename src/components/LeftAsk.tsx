"use client";

import { useEffect, useRef, useState } from "react";
import type { QAEntry } from "@/types/graph";

type Props = {
  onSelectQA: (id: string) => void;
  onAskAINow: (question: string) => void;
};

export default function LeftAsk({ onSelectQA, onAskAINow }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<QAEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);

  async function search(next?: string) {
    const query = (next ?? q).trim();
    if (!query) { setItems([]); setLoading(false); abortRef.current?.abort(); reqIdRef.current++; return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setItems([]);
    try {
      const res = await fetch("/api/qa/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 10, strict: true }),
        cache: "no-store",
        signal: controller.signal,
      });
      const j = await res.json().catch(() => ({ items: [] }));
      const its: QAEntry[] = Array.isArray(j?.items) ? (j.items as QAEntry[]) : [];
      if (myId === reqIdRef.current) setItems(its);
    } catch (e: unknown) {
      if ((e as any)?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      // Only the latest request can turn off loading
      if (myId === reqIdRef.current) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }

  useEffect(() => {
    const t = setTimeout(() => { void search(q); }, 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 bg-white dark:bg-gray-900 z-10 pb-2 border-b border-gray-100/60">
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if ((e as any).isComposing) return; // allow IME composition
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                const query = q.trim();
                if (query) onAskAINow(query);
              } else if (e.key === "Enter") {
                e.preventDefault();
                void search(q);
              }
            }}
            placeholder="질문을 입력하세요"
            className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
            id="left-ask"
            name="left-ask"
          />
          <button
            className="text-xs px-2 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
            disabled={q.trim().length === 0}
            onClick={() => { const query = q.trim(); if (query) onAskAINow(query); }}
          >AI에게 묻기</button>
        </div>
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      {loading && <div className="text-xs text-gray-500">검색 중...</div>}
      {!loading && items.length === 0 && q.trim().length > 0 && (
        <div className="text-xs text-gray-700 space-y-2">
          <div>유사한 Q&A가 없습니다.</div>
          <button
            className="text-xs px-2 py-1 rounded bg-emerald-600 text-white"
            onClick={() => onAskAINow(q.trim())}
          >지금 AI에게 묻기</button>
        </div>
      )}
      <ul className="space-y-2">
        {items.map((it) => (
          <SuggestItem key={it.id} it={it} onSelectQA={onSelectQA} />
        ))}
      </ul>
    </div>
  );
}

function SuggestItem({ it, onSelectQA }: { it: QAEntry; onSelectQA: (id: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [preview, setPreview] = useState<Array<{ id: string; question: string }>>([]);
  const [expanded, setExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`/api/qa/map?qaId=${encodeURIComponent(it.id)}`, { cache: "no-store", signal: controller.signal });
        const j = await r.json().catch(() => ({ nodes: [], edges: [] }));
        const nodes: Array<{ id: string; question: string }> = Array.isArray(j?.nodes) ? j.nodes : [];
        setCount(nodes.length || 0);
        const pv = nodes.slice(Math.max(0, nodes.length - 3));
        setPreview(pv);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
      } finally {
        setLoading(false);
      }
    })();
    return () => { controller.abort(); };
  }, [it.id]);

  return (
    <li className="rounded border border-gray-200/60 p-2 bg-white/60 dark:bg-gray-900/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 cursor-pointer hover:opacity-90" onClick={() => onSelectQA(it.id)}>
          <div className="text-sm font-medium line-clamp-2">Q: {it.question}</div>
          {it.summary && <div className="text-[11px] text-gray-600 mt-0.5 line-clamp-2">{it.summary}</div>}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 border">Chain {loading ? "…" : (count ?? 0)}</span>
          <button className="text-[11px] px-2 py-1 rounded border" onClick={() => setExpanded((v) => !v)}>{expanded ? "접기" : "보기"}</button>
        </div>
      </div>
      {expanded && preview.length > 0 && (
        <div className="mt-2 space-y-1">
          {preview.map((n) => (
            <div key={n.id} className="text-[12px] text-gray-700 truncate">→ {n.question}</div>
          ))}
        </div>
      )}
    </li>
  );
}
