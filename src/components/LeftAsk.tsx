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
  const [chainsLoading, setChainsLoading] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState<string>("");
  const searchKey = (keyword || "").trim();
  const searchActive = !!(searchKey || (Array.isArray(keywords) && keywords.length) || (Array.isArray(phrases) && phrases.length) || submittedQuery);
  const [edgesAll, setEdgesAll] = useState<Array<{ sourceId: string; targetId: string; type: string }>>([]);
  const [showGraph, setShowGraph] = useState(false);

  async function search(next?: string) {
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
    // disable auto text search; only Enter triggers search
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, refreshKey, keyword, JSON.stringify(keywords || []), JSON.stringify(phrases || []), threadRootId, searchActive]);

  // When input is cleared and no keyword filters, exit search mode
  useEffect(() => {
    const kwLen = Array.isArray(keywords) ? keywords.length : 0;
    const phLen = Array.isArray(phrases) ? phrases.length : 0;
    if (q.trim().length === 0 && !searchKey && kwLen === 0 && phLen === 0) {
      setSubmittedQuery("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, searchKey, JSON.stringify(keywords || []), JSON.stringify(phrases || [])]);

  useEffect(() => {
    if (threadRootId && !searchActive) return; // thread mode: keyword fetch handled separately unless search active
    if ((keyword || "").trim() || (keywords && keywords.length) || (phrases && phrases.length)) {
      void searchByKeyword();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, JSON.stringify(keywords || []), JSON.stringify(phrases || []), keywordMode, refreshKey, threadRootId, searchActive]);

  // Build grouped chains from search results (when not in thread mode or when search is active)
  useEffect(() => {
    if (threadRootId && !searchActive) return;
    let active = true;
    (async () => {
      try {
        if (items.length === 0) { if (active) { setChains([]); setNodesByIdThread(new Map()); setChainsLoading(false); setEdgesAll([]); } return; }
        setChainsLoading(true);
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
        const allEdges: Array<{ sourceId: string; targetId: string; type: string }> = [];
        const groups: string[][] = [];
        const MAX_PATHS = 500;
        for (const rid of Array.from(rootIds)) {
          try {
            const r = await fetch(`/api/qa/map?rootId=${encodeURIComponent(rid)}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({ nodes: [], edges: [] }));
            const nodes: Array<{ id: string; question: string; summary?: string; answer?: string }> = Array.isArray(j?.nodes) ? j.nodes : [];
            const edges: Array<{ sourceId: string; targetId: string; type: string }> = Array.isArray(j?.edges) ? j.edges : [];
            nodes.forEach((n) => allNodes.set(n.id, { id: n.id, question: n.question, summary: n.summary, answer: n.answer } as QAEntry));
            allEdges.push(...edges.map((e) => ({ sourceId: e.sourceId, targetId: e.targetId, type: String(e.type || "") })));
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
        if (active) { setChains(groups); setNodesByIdThread(allNodes); setEdgesAll(allEdges); }
      } catch {
        if (active) { setChains([]); setNodesByIdThread(new Map()); }
      } finally {
        if (active) setChainsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [threadRootId, items, keyword, keywordMode, JSON.stringify(keywords || []), JSON.stringify(phrases || []), searchActive]);

  // Thread mode: load nodes for the given root and show as a question-only list (disabled when search is active)
  useEffect(() => {
    let active = true;
    (async () => {
      if (!threadRootId || searchActive) return;
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
        if (active) { setItems(its); setNodesByIdThread(map); setChains(groups); setEdgesAll(edges); }
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
                if (query) { onClearKeyword?.(); setSubmittedQuery(query); void search(query); onAskAINow(query); }
              } else if (e.key === "Enter") {
                // no-op: only buttons or Ctrl/Cmd+Enter should trigger actions
              }
            }}
            placeholder="질문을 입력하세요"
            className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
            id="left-ask"
            name="left-ask"
          />
          <button
            className="text-xs px-2 py-2 rounded border text-gray-700 disabled:opacity-50"
            disabled={q.trim().length === 0}
            onClick={() => { const query = q.trim(); if (query) { onClearKeyword?.(); setSubmittedQuery(query); void search(query); } }}
          >기존 QA 검색</button>
          <button
            className="text-xs px-2 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
            disabled={q.trim().length === 0}
            onClick={() => { const query = q.trim(); if (query) { onClearKeyword?.(); setSubmittedQuery(query); void search(query); onAskAINow(query); } }}
          >AI에게 묻기</button>
          <button
            className="text-xs px-2 py-2 rounded border text-gray-700 disabled:opacity-50"
            disabled={nodesByIdThread.size === 0 || chains.length === 0}
            onClick={() => setShowGraph(true)}
          >그래프 보기</button>
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
      {!loading && !threadRootId && items.length === 0 && submittedQuery.length > 0 && (
        <div className="text-xs text-gray-700 space-y-2">
          <div>유사한 Q&A가 없습니다.</div>
          <button
            className="text-xs px-2 py-1 rounded bg-emerald-600 text-white"
            onClick={() => onAskAINow(q.trim())}
          >지금 AI에게 묻기</button>
        </div>
      )}
      {searchActive ? (
        // Search mode chains (Option B: only after computed)
        chainsLoading && chains.length === 0 ? (
          <div className="text-[11px] text-gray-600">체인 구성 중…</div>
        ) : (
          <ul className="space-y-2">
            {chains.map((chain, cidx) => (
              <li key={`ch-${cidx}`} className="rounded border border-gray-200/60 p-2 bg-white/60 dark:bg-gray-900/40">
                <div className="text-[11px] text-gray-600 mb-1">Chain {cidx + 1}{chainsLoading ? ' · 구성 중…' : ''}</div>
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
        )
      ) : (threadRootId ? (
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
      ))}
      {showGraph && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-900 rounded shadow-lg p-3 w-[920px] max-w-[95vw] max-h-[85vh] overflow-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">질문 체인 그래프 (Chain 1~5)</div>
              <button className="text-xs px-2 py-1 rounded border" onClick={() => setShowGraph(false)}>닫기</button>
            </div>
            {(() => {
              const selectedChains = chains.slice(0, 5);
              if (selectedChains.length === 0) return <div className="text-[12px] text-gray-600">체인이 없습니다.</div>;
              // depth -> unique node ids
              const colsMap = new Map<number, string[]>();
              selectedChains.forEach((ch) => {
                ch.forEach((id, d) => {
                  const arr = colsMap.get(d) || [];
                  if (!arr.includes(id)) arr.push(id);
                  colsMap.set(d, arr);
                });
              });
              const depths = Array.from(colsMap.keys()).sort((a, b) => a - b);
              // build ordering per depth based on parent -> children sequence to visualize branching
              const orderByDepth: string[][] = [];
              // depth 0: order by first occurrence across chains
              const seen0 = new Set<string>();
              const d0arr: string[] = [];
              selectedChains.forEach((ch) => { const id = ch[0]; if (id && !seen0.has(id)) { seen0.add(id); d0arr.push(id); } });
              orderByDepth[0] = d0arr;
              // child mapping between consecutive depths
              const childOf = new Map<string, Set<string>>();
              selectedChains.forEach((ch) => {
                for (let i = 0; i < ch.length - 1; i++) {
                  const a = ch[i], b = ch[i + 1];
                  if (!childOf.has(a)) childOf.set(a, new Set());
                  childOf.get(a)!.add(b);
                }
              });
              for (let di = 1; di < depths.length; di++) {
                const prev = orderByDepth[di - 1] || [];
                const nextIds = colsMap.get(depths[di]) || [];
                const seen = new Set<string>();
                const ord: string[] = [];
                prev.forEach((pid) => {
                  const chs = Array.from(childOf.get(pid) || []);
                  chs.forEach((cid) => { if (nextIds.includes(cid) && !seen.has(cid)) { seen.add(cid); ord.push(cid); } });
                });
                // append any remaining nodes at this depth
                nextIds.forEach((nid) => { if (!seen.has(nid)) { seen.add(nid); ord.push(nid); } });
                orderByDepth[di] = ord;
              }
              // edges between consecutive nodes in each chain (dedup)
              const edges: Array<[string, string]> = [];
              const edgeSet = new Set<string>();
              selectedChains.forEach((ch) => {
                for (let i = 0; i < ch.length - 1; i++) {
                  const k = `${ch[i]}->${ch[i + 1]}`;
                  if (!edgeSet.has(k)) { edgeSet.add(k); edges.push([ch[i], ch[i + 1]]); }
                }
              });
              const x0 = 40, y0 = 40;
              const colGap = 360; // width per column
              const nodeW = 320;
              const rowGap = 130;
              const wrap = (text: string, max = 30, maxLines = 5) => {
                const s = String(text || "");
                // word-based wrap first; if no spaces (CJK), fall back to char chunking
                const bySpace = s.includes(" ") ? s.split(/\s+/) : s.split("");
                const lines: string[] = [];
                let cur = "";
                for (const w of bySpace) {
                  const candidate = (cur ? cur + (s.includes(" ") ? " " : "") : "") + w;
                  if (candidate.length > max) {
                    if (cur) lines.push(cur);
                    cur = w;
                  } else {
                    cur = candidate;
                  }
                  if (lines.length >= maxLines) break;
                }
                if (lines.length < maxLines && cur) lines.push(cur);
                if (lines.length > maxLines) lines.length = maxLines;
                return lines;
              };
              const pos = new Map<string, { x: number; y: number; w: number; h: number; lines: string[] }>();
              depths.forEach((d, di) => {
                const arr = orderByDepth[di] || colsMap.get(d) || [];
                arr.forEach((id, rIndex) => {
                  const q = nodesByIdThread.get(id)?.question || id;
                  const lines = wrap(q);
                  const h = 16 + lines.length * 16 + 12;
                  const x = x0 + di * colGap;
                  const y = y0 + rIndex * rowGap;
                  pos.set(`${d}:${id}`, { x, y, w: nodeW, h, lines });
                });
              });
              const getKeyFor = (id: string): string | null => {
                for (let i = 0; i < depths.length; i++) { const key = `${depths[i]}:${id}`; if (pos.has(key)) return key; }
                return null;
              };
              const maxRows = orderByDepth.reduce((m, arr) => Math.max(m, (arr || []).length), 0);
              const W = Math.max(720, x0 + depths.length * colGap + 80);
              const H = Math.max(420, y0 + maxRows * rowGap + 40);
              return (
                <>
                  <svg width={W} height={H} className="border rounded w-full bg-white">
                    {edges.map((e, i) => {
                      const aKey = getKeyFor(e[0]);
                      const bKey = getKeyFor(e[1]);
                      if (!aKey || !bKey) return null;
                      const a = pos.get(aKey)!; const b = pos.get(bKey)!;
                      const ax = a.x + a.w; const ay = a.y + a.h / 2;
                      const bx = b.x; const by = b.y + b.h / 2;
                      const midx = (ax + bx) / 2;
                      return (
                        <g key={`e-${i}`}>
                          <path d={`M ${ax} ${ay} C ${midx} ${ay}, ${midx} ${by}, ${bx} ${by}`} stroke="#94a3b8" strokeWidth="1.5" fill="none" />
                        </g>
                      );
                    })}
                    {Array.from(pos.entries()).map(([k, p], i) => (
                      <g key={`n-${i}`}>
                        <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="6" ry="6" fill="#ffffff" stroke="#1f2937" strokeWidth="1.2" />
                        {p.lines.map((ln, idx) => (
                          <text key={`t-${i}-${idx}`} x={p.x + 10} y={p.y + 20 + idx * 16} fontSize="12" fill="#111827">{ln}</text>
                        ))}
                      </g>
                    ))}
                  </svg>
                  <div className="mt-2 text-[12px] text-gray-700">총 체인: {selectedChains.length} · 깊이: {depths.length}</div>
                </>
              );
            })()}
          </div>
        </div>
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
