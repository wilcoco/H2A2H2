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
  const [gZoom, setGZoom] = useState(1);
  const [gPanX, setGPanX] = useState(0);
  const [gPanY, setGPanY] = useState(0);
  const [gDragging, setGDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const isPointerDownRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastNodeDownRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const CLICK_TOL = 10;
  const [metricsByRoot, setMetricsByRoot] = useState<Record<string, { stakeRaw: number; helpful: number; unhelpful: number }>>({});

  // Lock background scroll while modal is open
  useEffect(() => {
    if (!showGraph) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [showGraph]);

  // Ensure wheel/pointer events behave consistently across browsers (non-passive wheel) with drag threshold
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setGZoom((z) => {
        const next = e.deltaY < 0 ? z * 1.1 : z * 0.9;
        return Math.max(0.3, Math.min(5, next));
      });
    };
    const onPointerDown = (e: PointerEvent) => {
      isPointerDownRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      dragRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      isPointerDownRef.current = false;
      setGDragging(false);
      dragRef.current = null;
      dragStartRef.current = null;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isPointerDownRef.current || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      // Activate drag only after threshold to avoid swallowing clicks
      if (!gDragging && dragStartRef.current) {
        const dx0 = e.clientX - dragStartRef.current.x;
        const dy0 = e.clientY - dragStartRef.current.y;
        if (Math.hypot(dx0, dy0) < 8) return;
        setGDragging(true);
      }
      if (!gDragging) return;
      const dxPx = e.clientX - (dragRef.current?.x || e.clientX);
      const dyPx = e.clientY - (dragRef.current?.y || e.clientY);
      const W = Number((svgRef.current.viewBox.baseVal?.width || 0) || 0) || rect.width;
      const H = Number((svgRef.current.viewBox.baseVal?.height || 0) || 0) || rect.height;
      const unitX = (W / rect.width) / gZoom;
      const unitY = (H / rect.height) / gZoom;
      setGPanX((p) => p + dxPx * unitX);
      setGPanY((p) => p + dyPx * unitY);
      dragRef.current = { x: e.clientX, y: e.clientY };
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointerleave', onPointerUp);
    el.addEventListener('pointermove', onPointerMove);
    return () => {
      el.removeEventListener('wheel', onWheel as EventListener);
      el.removeEventListener('pointerdown', onPointerDown as EventListener);
      el.removeEventListener('pointerup', onPointerUp as EventListener);
      el.removeEventListener('pointerleave', onPointerUp as EventListener);
      el.removeEventListener('pointermove', onPointerMove as EventListener);
    };
  }, [gDragging, gZoom]);

  async function search(next?: string, force?: boolean) {
    if (!force && ((keyword || "").trim() || (keywords && keywords.length) || (phrases && phrases.length))) return; // 기본: 키워드/복합어 모드일 땐 텍스트 검색 비활성화
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
        const met: Record<string, { stakeRaw: number; helpful: number; unhelpful: number }> = {};
        const MAX_PATHS = 500;
        for (const rid of Array.from(rootIds)) {
          try {
            const r = await fetch(`/api/qa/map?rootId=${encodeURIComponent(rid)}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({ nodes: [], edges: [] }));
            const nodes: Array<{ id: string; question: string; summary?: string; answer?: string }> = Array.isArray(j?.nodes) ? j.nodes : [];
            const edges: Array<{ sourceId: string; targetId: string; type: string }> = Array.isArray(j?.edges) ? j.edges : [];
            if (j?.metrics && typeof j.metrics === 'object') {
              const m = j.metrics as { stakeRaw?: unknown; helpful?: unknown; unhelpful?: unknown };
              met[rid] = { stakeRaw: Number(m.stakeRaw || 0), helpful: Number(m.helpful || 0), unhelpful: Number(m.unhelpful || 0) };
            }
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
        if (active) { setChains(groups); setNodesByIdThread(allNodes); setEdgesAll(allEdges); setMetricsByRoot((prev) => ({ ...prev, ...met })); }
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
        if (j?.metrics && typeof j.metrics === 'object') {
          const m = j.metrics as { stakeRaw?: unknown; helpful?: unknown; unhelpful?: unknown };
          setMetricsByRoot((prev) => ({ ...prev, [threadRootId]: { stakeRaw: Number(m.stakeRaw || 0), helpful: Number(m.helpful || 0), unhelpful: Number(m.unhelpful || 0) } }));
        }
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

  // Default feed: when not searching and not in thread mode, load staked-normalized feed
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (searchActive) return;
        if (threadRootId) return;
        setLoading(true);
        setError(null);
        const r = await fetch(`/api/qa/feed?sort=staked&window=24h&limit=20`, { cache: "no-store" });
        const j = await r.json().catch(() => ({ items: [] }));
        const its: QAEntry[] = Array.isArray(j?.items)
          ? (j.items as Array<{ id: string; rootId?: string; question?: string }> ).map((x) => ({ id: x.id, question: x.question || x.id }))
          : [];
        if (Array.isArray(j?.items)) {
          const mm: Record<string, { stakeRaw: number; helpful: number; unhelpful: number }> = {};
          for (const x of j.items as Array<{ id: string; stakeRaw?: number; helpful?: number; unhelpful?: number }>) {
            mm[x.id] = { stakeRaw: Number(x.stakeRaw || 0), helpful: Number(x.helpful || 0), unhelpful: Number(x.unhelpful || 0) };
          }
          if (active) setMetricsByRoot(mm);
        }
        if (active) setItems(its);
      } catch (e: unknown) {
        if (active) setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [searchActive, threadRootId, refreshKey]);

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 bg-white dark:bg-gray-900 z-10 pb-2 border-b border-gray-100/60">
        <div className="flex flex-col gap-2">
          <textarea
            rows={1}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onInput={(e) => { const el = e.currentTarget as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return; // allow IME composition
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                const query = q.trim();
                if (query) { onClearKeyword?.(); setSubmittedQuery(query); void search(query, true); onAskAINow(query); }
              } else if (e.key === "Enter") {
                // no-op: only buttons or Ctrl/Cmd+Enter should trigger actions
              }
            }}
            placeholder="질문을 입력하세요"
            className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60 resize-none overflow-hidden"
            id="left-ask"
            name="left-ask"
          />
          <div className="flex items-center gap-2">
            <button
              className="text-xs px-2 py-2 rounded border text-gray-700 disabled:opacity-50"
              disabled={q.trim().length === 0}
              onClick={() => { const query = q.trim(); if (query) { onClearKeyword?.(); setSubmittedQuery(query); void search(query, true); } }}
            >기존 QA 검색</button>
            <button
              className="text-xs px-2 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
              disabled={q.trim().length === 0}
              onClick={() => { const query = q.trim(); if (query) { onClearKeyword?.(); setSubmittedQuery(query); void search(query, true); onAskAINow(query); } }}
            >AI에게 묻기</button>
            <button
              className="text-xs px-2 py-2 rounded border text-gray-700"
              onClick={() => { setShowGraph(true); setGZoom(1); setGPanX(0); setGPanY(0); }}
            >그래프 보기</button>
          </div>
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
                <div className="text-[11px] text-gray-600 mb-1">
                  {(() => { const rid = chain[0]; const m = rid ? metricsByRoot[rid] : undefined; return (
                    <>Chain {cidx + 1}{chainsLoading ? ' · 구성 중…' : ''}{m ? <> · 예치 {m.stakeRaw} · 도움됨 {m.helpful} · 비도움 {m.unhelpful}</> : null}</>
                  ); })()}
                </div>
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
              <div className="text-[11px] text-gray-600 mb-1">
                {(() => { const rid = chain[0]; const m = rid ? metricsByRoot[rid] : undefined; return (
                  <>Chain {cidx + 1}{m ? <> · 예치 {m.stakeRaw} · 도움됨 {m.helpful} · 비도움 {m.unhelpful}</> : null}</>
                ); })()}
              </div>
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
            <SuggestItem key={it.id} it={it} index={idx} onSelectQA={onSelectQA} metrics={metricsByRoot[it.id]} />
          ))}
        </ul>
      ))}
      {showGraph && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-900 rounded shadow-lg p-3 w-[920px] max-w-[95vw] max-h-[85vh] overflow-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">질문 체인 그래프 (Chain 1~5)</div>
              <div className="flex items-center gap-2">
                <button className="text-xs px-2 py-1 rounded border" onClick={() => setGZoom((z) => Math.max(0.3, z * 0.8))}>-</button>
                <button className="text-xs px-2 py-1 rounded border" onClick={() => { setGZoom(1); setGPanX(0); setGPanY(0); }}>Fit</button>
                <button className="text-xs px-2 py-1 rounded border" onClick={() => setGZoom((z) => Math.min(5, z * 1.25))}>+</button>
                <button className="text-xs px-2 py-1 rounded border" onClick={() => setShowGraph(false)}>닫기</button>
              </div>
            </div>
            {(() => {
              const selectedChains = chains.slice(0, 5);
              if (chainsLoading && selectedChains.length === 0) return <div className="text-[12px] text-gray-600">체인 구성 중…</div>;
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
                  <div className="border rounded w-full bg-white" style={{ height: "70vh" }}>
                    <svg
                      ref={svgRef}
                      className="w-full h-full"
                      viewBox={`0 0 ${W} ${H}`}
                      style={{ touchAction: 'none', cursor: gDragging ? 'grabbing' as const : 'grab' as const }}
                    >
                      <g transform={`translate(${gPanX} ${gPanY}) scale(${gZoom})`}>
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
                          <g
                            key={`n-${i}`}
                            role="button"
                            tabIndex={0}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const nid = k.split(":")[1] || "";
                              lastNodeDownRef.current = { id: nid, x: e.clientX, y: e.clientY };
                            }}
                            onPointerUp={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const nid = k.split(":")[1] || "";
                              const dn = lastNodeDownRef.current;
                              lastNodeDownRef.current = null;
                              // End any ongoing pan drag to avoid stuck states
                              isPointerDownRef.current = false;
                              setGDragging(false);
                              dragRef.current = null;
                              dragStartRef.current = null;
                              if (!dn || dn.id !== nid) return;
                              const dx = Math.abs(e.clientX - dn.x);
                              const dy = Math.abs(e.clientY - dn.y);
                              if (dx <= CLICK_TOL && dy <= CLICK_TOL && !gDragging) {
                                const ch = selectedChains.find((c) => c.includes(nid));
                                if (ch) onSelectChainPath?.(ch);
                                if (nid) onSelectQA(nid);
                                setShowGraph(false);
                              }
                            }}
                            onClick={(e) => { // fallback for mouse
                              e.stopPropagation();
                              const nid = k.split(":")[1] || "";
                              const ch = selectedChains.find((c) => c.includes(nid));
                              if (ch) onSelectChainPath?.(ch);
                              if (nid) onSelectQA(nid);
                              setShowGraph(false);
                            }}
                            style={{ cursor: 'pointer' }}
                          >
                            <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="6" ry="6" fill="#ffffff" stroke="#1f2937" strokeWidth="1.2" />
                            {p.lines.map((ln, idx) => (
                              <text key={`t-${i}-${idx}`} x={p.x + 10} y={p.y + 20 + idx * 16} fontSize="12" fill="#111827">{ln}</text>
                            ))}
                          </g>
                        ))}
                      </g>
                    </svg>
                  </div>
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

function SuggestItem({ it, index, onSelectQA, metrics }: { it: QAEntry; index: number; onSelectQA: (id: string) => void; metrics?: { stakeRaw: number; helpful: number; unhelpful: number } }) {
  return (
    <li className="rounded border border-gray-200/60 p-2 bg-white/60 dark:bg-gray-900/40">
      <div className="flex items-center justify-between gap-2">
        <button className="min-w-0 text-left text-sm font-medium truncate hover:opacity-90" onClick={() => onSelectQA(it.id)}>
          <span className="text-gray-500 mr-1">Q{index + 1}.</span>
          <span className="line-clamp-1">{it.question}</span>
        </button>
      </div>
      {metrics && (
        <div className="text-[11px] text-gray-600 mt-1">예치 {metrics.stakeRaw} · 도움됨 {metrics.helpful} · 비도움 {metrics.unhelpful}</div>
      )}
    </li>
  );
}
