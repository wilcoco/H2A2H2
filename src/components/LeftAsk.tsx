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
          <li key={it.id} className="rounded border border-gray-200/60 p-2 bg-white/60 dark:bg-gray-900/40 cursor-pointer hover:bg-gray-50" onClick={() => onSelectQA(it.id)}>
            <div className="text-sm font-medium line-clamp-2">Q: {it.question}</div>
            {it.summary && <div className="text-[11px] text-gray-600 mt-0.5 line-clamp-2">{it.summary}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
