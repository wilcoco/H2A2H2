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
  keywords?: string[] | null;
  phrases?: string[] | null;
  onClearKeyword?: () => void;
  contextIds?: string[];
  onToggleContext?: (id: string, next: boolean) => void;
  threadRootId?: string | null;
  onSelectChainPath?: (path: string[]) => void;
};

export default function LeftAsk({ onSelectQA, onAskAINow, connectMode, targetId, onPickTarget, refreshKey, keyword, keywordMode = "any", keywords = null, phrases = null, onClearKeyword, contextIds = [], onToggleContext, threadRootId = null, onSelectChainPath }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<QAEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);
  const [chains, setChains] = useState<string[][]>([]);
  const [nodesByIdThread, setNodesByIdThread] = useState<Map<string, QAEntry>>(new Map());

  async function search(next?: string) {
    if (threadRootId) return; // thread mode skips text search
    if ((keyword || "").trim() || (keywords && keywords.length) || (phrases && phrases.length)) return; // 키워드/복합어 모드일 땐 텍스트 검색 비활성화
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
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      // Only the latest request can turn off loading
      if (myId === reqIdRef.current) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }

  async function searchByKeyword() {
    if (threadRootId) return; // thread mode skips keyword search
    const key = (keyword || "").trim();
    const kwArr = Array.isArray(keywords) ? keywords.filter((s) => (s || "").trim().length > 0) : [];
    const phArr = Array.isArray(phrases) ? phrases.filter((s) => (s || "").trim().length > 0) : [];
    if (!key && kwArr.length === 0 && phArr.length === 0) { setItems([]); setLoading(false); abortRef.current?.abort(); reqIdRef.current++; return; }
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
        body: JSON.stringify({ keyword: key || undefined, keywords: kwArr.length ? kwArr : undefined, phrases: phArr.length ? phArr : undefined, mode: keywordMode, limit: 10 }),
        cache: "no-store",
        signal: controller.signal,
      });
      const j = await res.json().catch(() => ({ items: [] }));
      const its: QAEntry[] = Array.isArray(j?.items) ? (j.items as QAEntry[]) : [];
      if (myId === reqIdRef.current) setItems(its);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (myId === reqIdRef.current) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }

  useEffect(() => {
    if (threadRootId) return; // thread mode: do not debounce text search
    if ((keyword || "").trim() || (keywords && keywords.length) || (phrases && phrases.length)) return; // 키워드/복합어 모드일 때는 텍스트 디바운스 검색 생략
    const t = setTimeout(() => { void search(q); }, 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, refreshKey, keyword, JSON.stringify(keywords || []), JSON.stringify(phrases || [])]);

  useEffect(() => {
    if (threadRootId) return; // thread mode: keyword fetch handled separately
    if ((keyword || "").trim() || (keywords && keywords.length) || (phrases && phrases.length)) {
      void searchByKeyword();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, JSON.stringify(keywords || []), JSON.stringify(phrases || []), keywordMode, refreshKey]);

  // Build grouped chains from search results (when not in thread mode)
  useEffect(() => {
    if (threadRootId) return;
    let active = true;
    (async () => {
      try {
        if (items.length === 0) { if (active) { setChains([]); setNodesByIdThread(new Map()); } return; }
        // 1) Resolve roots for all items
        const rootIds = new Set<string>();
        await Promise.all(items.map(async (it) => {
          try {
            const r = await fetch(`/api/qa/map?qaId=${encodeURIComponent(it.id)}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            const rid = j?.rootId ? String(j.rootId) : it.id;
            rootIds.add(rid);
          } catch {}
        }));
        // 2) Fetch maps for each root and enumerate root-to-leaf paths
        const allNodes = new Map<string, QAEntry>();
        const groups: string[][] = [];
        const MAX_PATHS = 500;
        for (const rid of Array.from(rootIds)) {
          try {
            const r = await fetch(`/api/qa/map?rootId=${encodeURIComponent(rid)}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({ nodes: [], edges: [] }));
            const nodes: Array<{ id: string; question: string; summary?: string; answer?: string }> = Array.isArray(j?.nodes) ? j.nodes : [];
            const edges: Array<{ sourceId: string; targetId: string; type: string }> = Array.isArray(j?.edges) ? j.edges : [];
            nodes.forEach((n) => allNodes.set(n.id, { id: n.id, question: n.question, summary: n.summary, answer: n.answer } as QAEntry));
            const pres = edges.filter((e) => (e.type || "").toLowerCase() === "precedes");
            const nextOf = new Map<string, string[]>();
            const inDeg = new Map<string, number>();
            for (const n of nodes) { inDeg.set(n.id, 0); }
            for (const e of pres) {
              if (!nextOf.has(e.sourceId)) nextOf.set(e.sourceId, []);
              nextOf.get(e.sourceId)!.push(e.targetId);
              inDeg.set(e.targetId, (inDeg.get(e.targetId) || 0) + 1);
            }
            const starts: string[] = [rid];
            function dfs(cur: string, path: string[], seen: Set<string>) {
              if (groups.length >= MAX_PATHS) return;
              if (seen.has(cur)) { groups.push([...path]); return; }
              seen.add(cur);
              const children = (nextOf.get(cur) || []).filter((nid) => allNodes.has(nid));
              if (children.length === 0) { groups.push([...path]); return; }
              for (const ch of children) {
                dfs(ch, [...path, ch], new Set(seen));
                if (groups.length >= MAX_PATHS) break;
              }
            }
            for (const s of starts) {
              dfs(s, [s], new Set());
              if (groups.length >= MAX_PATHS) break;
            }
          } catch {}
        }
        if (active) { setChains(groups); setNodesByIdThread(allNodes); }
      } catch {
        if (active) { setChains([]); setNodesByIdThread(new Map()); }
      }
    })();
    return () => { active = false; };
  }, [threadRootId, items, keyword, keywordMode, JSON.stringify(keywords || []), JSON.stringify(phrases || [])]);

  // Thread mode: load nodes for the given root and show as a question-only list
  useEffect(() => {
    let active = true;
    (async () => {
      if (!threadRootId) return;
      try {
        setLoading(true);
        setError(null);
        const r = await fetch(`/api/qa/map?rootId=${encodeURIComponent(threadRootId)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({ nodes: [], edges: [] }));
        const its: QAEntry[] = Array.isArray(j?.nodes)
          ? (j.nodes as Array<{ id: string; question: string; summary?: string; answer?: string }>).map((n) => ({ id: n.id, question: n.question, summary: n.summary, answer: n.answer }))
          : [];
        const map = new Map<string, QAEntry>();
        for (const it of its) map.set(it.id, it);
        const edges: Array<{ sourceId: string; targetId: string; type: string }> = Array.isArray(j?.edges) ? j.edges : [];
        const pres = edges.filter((e) => (e.type || "").toLowerCase() === "precedes");
        const nextOf = new Map<string, string[]>();
        const inDeg = new Map<string, number>();
        for (const id of Array.from(map.keys())) { inDeg.set(id, 0); }
        for (const e of pres) {
          if (!nextOf.has(e.sourceId)) nextOf.set(e.sourceId, []);
          nextOf.get(e.sourceId)!.push(e.targetId);
          inDeg.set(e.targetId, (inDeg.get(e.targetId) || 0) + 1);
        }
        // Determine start nodes: prefer explicit threadRootId if present, else all visible heads (in-degree 0)
        const starts: string[] = (() => {
          if (map.has(threadRootId!)) return [threadRootId!];
          const hs = Array.from(map.keys()).filter((id) => (inDeg.get(id) || 0) === 0);
          return hs.length ? hs : Array.from(map.keys());
        })();
        // Enumerate all root-to-leaf paths
        const groups: string[][] = [];
        const MAX_PATHS = 500; // guardrail
        function dfs(cur: string, path: string[], seen: Set<string>) {
          if (groups.length >= MAX_PATHS) return;
          if (seen.has(cur)) { groups.push([...path]); return; }
          seen.add(cur);
          const children = (nextOf.get(cur) || []).filter((nid) => map.has(nid));
          if (children.length === 0) { groups.push([...path]); return; }
          for (const ch of children) {
            dfs(ch, [...path, ch], new Set(seen));
            if (groups.length >= MAX_PATHS) break;
          }
        }
        for (const s of starts) {
          dfs(s, [s], new Set());
          if (groups.length >= MAX_PATHS) break;
        }
        if (active) { setItems(its); setNodesByIdThread(map); setChains(groups); }
      } catch (e: unknown) {
        if (active) setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [threadRootId, refreshKey]);

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 bg-white dark:bg-gray-900 z-10 pb-2 border-b border-gray-100/60">
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return; // allow IME composition
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
        {(((keyword || "").trim()) || (keywords && keywords.length) || (phrases && phrases.length)) && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {phrases && phrases.length > 0 ? (
              <>
                <span className="text-[10px] px-2 py-0.5 rounded-full border bg-purple-50 border-purple-200 text-purple-700">복합어</span>
                {phrases.slice(0, 4).map((p, i) => (
                  <span key={`ph-b-${i}`} className="text-[10px] px-2 py-0.5 rounded-full border">{p}</span>
                ))}
              </>
            ) : (keywords && keywords.length > 0 ? (
              <>
                <span className="text-[10px] px-2 py-0.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700">단어 {keywordMode?.toUpperCase?.()}</span>
                {keywords.slice(0, 5).map((k, i) => (
                  <span key={`kw-b-${i}`} className="text-[10px] px-2 py-0.5 rounded-full border">{k}</span>
                ))}
              </>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700">키워드: {keyword}</span>
            ))}
            <button className="text-[11px] px-2 py-0.5 rounded border" onClick={() => onClearKeyword?.()}>Clear</button>
          </div>
        )}
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      {loading && <div className="text-xs text-gray-500">검색 중...</div>}
      {!loading && !threadRootId && items.length === 0 && q.trim().length > 0 && (
        <div className="text-xs text-gray-700 space-y-2">
          <div>유사한 Q&A가 없습니다.</div>
          <button
            className="text-xs px-2 py-1 rounded bg-emerald-600 text-white"
            onClick={() => onAskAINow(q.trim())}
          >지금 AI에게 묻기</button>
        </div>
      )}
      {(threadRootId || chains.length > 0) ? (
        <ul className="space-y-2">
          {chains.map((chain, cidx) => (
            <li key={`ch-${cidx}`} className="rounded border border-gray-200/60 p-2 bg-white/60 dark:bg-gray-900/40">
              <div className="text-[11px] text-gray-600 mb-1">Chain {cidx + 1}</div>
              <ul className="space-y-1">
                {chain.map((id) => {
                  const it = nodesByIdThread.get(id);
                  if (!it) return null;
                  return (
                    <li key={id} className="flex items-center justify-between gap-2">
                      <button className="min-w-0 text-left text-sm truncate hover:opacity-90" onClick={() => { onSelectChainPath?.(chain); onSelectQA(id); }}>
                        <span className="line-clamp-1">Q: {it.question}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2">
          {items.map((it, idx) => (
            <SuggestItem key={it.id} it={it} index={idx} onSelectQA={onSelectQA} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestItem({ it, index, onSelectQA }: { it: QAEntry; index: number; onSelectQA: (id: string) => void }) {
  return (
    <li className="rounded border border-gray-200/60 p-2 bg-white/60 dark:bg-gray-900/40">
      <div className="flex items-center justify-between gap-2">
        <button className="min-w-0 text-left text-sm font-medium truncate hover:opacity-90" onClick={() => onSelectQA(it.id)}>
          <span className="text-gray-500 mr-1">Q{index + 1}.</span>
          <span className="line-clamp-1">{it.question}</span>
        </button>
      </div>
    </li>
  );
}
