"use client";

import { useEffect, useRef, useState } from "react";
import type { QAEntry } from "@/types/graph";

type Props = {
  onSelectQA: (id: string) => void;
  onAskAINow: (question: string) => void;
  connectMode?: boolean;
  targetId?: string | null;
  onPickTarget?: (id: string) => void;
  refreshKey?: number;
  keyword?: string | null;
  keywordMode?: "any" | "all";
  onClearKeyword?: () => void;
};

export default function LeftAsk({ onSelectQA, onAskAINow, connectMode, targetId, onPickTarget, refreshKey, keyword, keywordMode = "any", onClearKeyword }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<QAEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);

  async function search(next?: string) {
    if ((keyword || "").trim()) return; // keyword 모드일 땐 텍스트 검색 비활성화
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

  async function searchByKeyword(kw: string) {
    const key = (kw || "").trim();
    if (!key) { setItems([]); setLoading(false); abortRef.current?.abort(); reqIdRef.current++; return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setItems([]);
    try {
      const res = await fetch("/api/qa/byKeyword", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: key, mode: keywordMode, limit: 10 }),
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
      if (myId === reqIdRef.current) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }

  useEffect(() => {
    if ((keyword || "").trim()) return; // 키워드 모드일 때는 텍스트 디바운스 검색을 생략
    const t = setTimeout(() => { void search(q); }, 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, refreshKey, keyword]);

  useEffect(() => {
    const k = (keyword || "").trim();
    if (!k) return;
    void searchByKeyword(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, keywordMode, refreshKey]);

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
                if (query) { onClearKeyword?.(); onAskAINow(query); }
              } else if (e.key === "Enter") {
                e.preventDefault();
                onClearKeyword?.();
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
            onClick={() => { const query = q.trim(); if (query) { onClearKeyword?.(); onAskAINow(query); } }}
          >AI에게 묻기</button>
        </div>
        {(keyword || "").trim() && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700">키워드: {keyword}</span>
            <button className="text-[11px] px-2 py-0.5 rounded border" onClick={() => onClearKeyword?.()}>Clear</button>
          </div>
        )}
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
          <SuggestItem key={it.id} it={it} onSelectQA={onSelectQA} connectMode={!!connectMode} targetId={targetId || null} onPickTarget={onPickTarget} refreshKey={refreshKey || 0} />
        ))}
      </ul>
    </div>
  );
}

function SuggestItem({ it, onSelectQA, connectMode, targetId, onPickTarget, refreshKey }: { it: QAEntry; onSelectQA: (id: string) => void; connectMode: boolean; targetId: string | null; onPickTarget?: (id: string) => void; refreshKey: number }) {
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [preview, setPreview] = useState<Array<{ id: string; question: string; summary?: string }>>([]);
  const [edges, setEdges] = useState<Array<{ sourceId: string; targetId: string; type: string }>>([]);
  const [nodesById, setNodesById] = useState<Map<string, { id: string; question: string; summary?: string }>>(new Map());
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
        const nodes: Array<{ id: string; question: string; summary?: string }> = Array.isArray(j?.nodes) ? j.nodes : [];
        setCount(nodes.length || 0);
        const map = new Map<string, { id: string; question: string; summary?: string }>();
        nodes.forEach((n) => map.set(n.id, { id: n.id, question: n.question, summary: n.summary }));
        setNodesById(map);
        const pv = nodes.slice(Math.max(0, nodes.length - 3));
        setPreview(pv);
        const es: Array<{ sourceId: string; targetId: string; type: string }> = Array.isArray(j?.edges) ? j.edges : [];
        setEdges(es);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
      } finally {
        setLoading(false);
      }
    })();
    return () => { controller.abort(); };
  }, [it.id, refreshKey]);

  return (
    <li className="rounded border border-gray-200/60 p-2 bg-white/60 dark:bg-gray-900/40">
      <div className="min-w-0 cursor-pointer hover:opacity-90" onClick={() => onSelectQA(it.id)}>
        <div className="text-sm font-medium line-clamp-3">Q: {it.question}</div>
        {it.summary && <div className="text-[11px] text-gray-600 mt-0.5 line-clamp-3">{it.summary}</div>}
      </div>
      <div className="mt-1 flex items-center gap-2 justify-end">
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 border">Chain {loading ? "…" : (count ?? 0)}</span>
        <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => setExpanded((v) => !v)}>{expanded ? "접기" : "자세히"}</button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2">
          <div>
            <div className="text-[11px] text-gray-600 mb-1">연결(현재 → 타겟)</div>
            {edges.filter((e) => e.sourceId === it.id).length > 0 ? (
              <ul className="space-y-1">
                {edges.filter((e) => e.sourceId === it.id).slice(0, 5).map((e, idx) => {
                  const trg = nodesById.get(e.targetId);
                  if (!trg) return null;
                  return (
                    <li key={`out-${idx}`} className="text-[12px] text-gray-700 truncate">
                      {e.type} · Q: {trg.question}
                      {trg.summary && <span className="text-[11px] text-gray-500"> — {trg.summary}</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="text-[11px] text-gray-500">없음</div>
            )}
          </div>
          <div>
            <div className="text-[11px] text-gray-600 mb-1">연결(소스 → 현재)</div>
            {edges.filter((e) => e.targetId === it.id).length > 0 ? (
              <ul className="space-y-1">
                {edges.filter((e) => e.targetId === it.id).slice(0, 5).map((e, idx) => {
                  const src = nodesById.get(e.sourceId);
                  if (!src) return null;
                  return (
                    <li key={`in-${idx}`} className="text-[12px] text-gray-700 truncate">
                      Q: {src.question} · {e.type}
                      {src.summary && <span className="text-[11px] text-gray-500"> — {src.summary}</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="text-[11px] text-gray-500">없음</div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
