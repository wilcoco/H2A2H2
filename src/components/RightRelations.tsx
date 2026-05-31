"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  qaId?: string;
  targetId?: string | null;
  onTargetChange?: (id: string | null) => void;
  connectMode?: boolean;
  onConnectModeChange?: (v: boolean) => void;
  pinnedIds?: string[];
  onUnpin?: (id: string) => void;
  onGraphChanged?: () => void;
  refreshKey?: number;
  navDirection?: "prev_to_current" | "current_to_prev";
  onNavDirectionChange?: (d: "prev_to_current" | "current_to_prev") => void;
  forceSourceId?: string | null;
  writerQaId?: string | null;
  onEdit?: (id: string) => void;
};

export default function RightRelations({ qaId, targetId, onTargetChange, connectMode, onConnectModeChange, pinnedIds = [], onUnpin, onGraphChanged, refreshKey, navDirection = "prev_to_current", onNavDirectionChange, forceSourceId, writerQaId, onEdit }: Props) {
  const [relType, setRelType] = useState<string>("precedes");
  const [busy, setBusy] = useState(false);
  const [edges, setEdges] = useState<Array<{ sourceId: string; targetId: string; type: string; synthetic?: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<{ id: string; question: string; createdBy?: string } | null>(null);
  const [target, setTarget] = useState<{ id: string; question: string; createdBy?: string } | null>(null);
  const [myQ, setMyQ] = useState("");
  const [myLoading, setMyLoading] = useState(false);
  const [myItems, setMyItems] = useState<Array<{ id: string; question: string; summary?: string; helpful?: number; unhelpful?: number }>>([]);
  const myReqRef = useRef(0);
  const myAbortRef = useRef<AbortController | null>(null);
  const [pinnedItems, setPinnedItems] = useState<Array<{ id: string; question: string; summary?: string; answer?: string }>>([]);
  const [srcOverrideId, setSrcOverrideId] = useState<string | null>(null);
  const [srcOverride, setSrcOverride] = useState<{ id: string; question: string; createdBy?: string } | null>(null);
  const [relNodes, setRelNodes] = useState<Map<string, { id: string; question: string; summary?: string; answer?: string }>>(new Map());
  const [autoType, setAutoType] = useState(true);
  const [manualSource, setManualSource] = useState(false);
  const [writerInfo, setWriterInfo] = useState<{ id: string; question: string; createdBy?: string } | null>(null);

  useEffect(() => { setError(null); }, [qaId]);

  useEffect(() => { setSource(null); }, [qaId]);

  // Remove default source behavior; only explicit Set Source should assign srcOverrideId

  // Force source assignment from center action
  useEffect(() => {
    if (forceSourceId && srcOverrideId !== forceSourceId) {
      setSrcOverrideId(forceSourceId);
      setManualSource(true);
    }
  }, [forceSourceId, srcOverrideId]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!targetId) { if (active) setTarget(null); return; }
      try {
        const r = await fetch(`/api/qa/${encodeURIComponent(targetId)}`, { cache: "no-store" });
        const j = await r.json();
        if (active) setTarget({ id: targetId, question: String(j?.question || ""), createdBy: j?.createdBy ? String(j.createdBy) : undefined });
      } catch { if (active) setTarget(null); }
    })();
    return () => { active = false; };
  }, [targetId]);

  // Load writer doc info
  useEffect(() => {
    let active = true;
    (async () => {
      if (!writerQaId) { if (active) setWriterInfo(null); return; }
      try {
        const r = await fetch(`/api/qa/${encodeURIComponent(writerQaId)}`, { cache: "no-store" });
        const j = await r.json();
        if (active) setWriterInfo({ id: writerQaId, question: String(j?.question || writerQaId), createdBy: j?.createdBy ? String(j.createdBy) : undefined });
      } catch { if (active) setWriterInfo(null); }
    })();
    return () => { active = false; };
  }, [writerQaId]);

  // Heuristic suggestion for relation type when both sides are known
  useEffect(() => {
    if (!autoType) return;
    const s = (srcOverride?.question || "").toLowerCase();
    const t = (target?.question || "").toLowerCase();
    if (!s || !t) return;
    const has = (str: string, arr: string[]) => arr.some((k) => str.includes(k));
    let suggestion = "precedes";
    if (has(t, ["예:", "예시", "사례", "예를 들어", "요약", "정리", "적용", "로컬라이즈"])) suggestion = "elaborates";
    else if (has(t, ["정의", "의미", "란", "오해", "명확"])) suggestion = "clarifies";
    else if (has(t, ["먼저", "선행", "필요", "해야", "전제", "필수"])) suggestion = "prerequisite";
    else if (t.length > s.length + 10 || has(t, ["종류", "유형", "세부", "특정"])) suggestion = "narrows";
    setRelType(suggestion);
  }, [autoType, srcOverride?.question, source?.question, target?.question]);

  async function connect() {
    const src = srcOverrideId;
    if (!src || !targetId || !relType) return;
    try {
      setBusy(true); setError(null);
      const res = await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: src, targetId, type: relType, weight: 1 }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Connect failed");
      }
      onTargetChange?.(null);
      setTarget(null);
      setSrcOverrideId(null);
      await refreshEdges();
      onGraphChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const arr = await Promise.all(
          (pinnedIds || []).map(async (id) => {
            try {
              const r = await fetch(`/api/qa/${encodeURIComponent(id)}`, { cache: "no-store" });
              const j = await r.json();
              return { id, question: String(j?.question || id), summary: j?.summary ? String(j.summary) : undefined, answer: j?.answer ? String(j.answer) : undefined };
            } catch {
              return { id, question: id, summary: undefined, answer: undefined };
            }
          })
        );
        if (active) setPinnedItems(arr);
      } catch {
        if (active) setPinnedItems([]);
      }
    })();
    return () => { active = false; };
  }, [JSON.stringify(pinnedIds)]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!srcOverrideId) { if (active) setSrcOverride(null); return; }
      try {
        const r = await fetch(`/api/qa/${encodeURIComponent(srcOverrideId)}`, { cache: "no-store" });
        const j = await r.json();
        if (active) setSrcOverride({ id: srcOverrideId, question: String(j?.question || ""), createdBy: j?.createdBy ? String(j.createdBy) : undefined });
      } catch { if (active) setSrcOverride(null); }
    })();
    return () => { active = false; };
  }, [srcOverrideId]);

  async function refreshEdges() {
    if (!qaId) { setEdges([]); return; }
    try {
      const r = await fetch(`/api/qa/map?qaId=${encodeURIComponent(qaId)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({ nodes: [], edges: [] }));
      const es: Array<{ sourceId: string; targetId: string; type: string; synthetic?: boolean }> = Array.isArray(j?.edges) ? j.edges : [];
      setEdges(es.filter((e) => e.sourceId === qaId || e.targetId === qaId).slice(0, 20));
    } catch {}
  }

  useEffect(() => { void refreshEdges(); }, [qaId, refreshKey]);

  // Load node details for related nodes to display human-friendly titles/snippets
  useEffect(() => {
    let active = true;
    (async () => {
      if (!qaId) { if (active) setRelNodes(new Map()); return; }
      const want = new Set<string>();
      for (const e of edges) {
        const otherId: string = e.sourceId === qaId ? e.targetId : e.sourceId;
        if (otherId && otherId !== qaId && !relNodes.has(otherId)) want.add(otherId);
      }
      if (want.size === 0) return;
      try {
        const arr = await Promise.all(
          Array.from(want).map(async (id) => {
            try {
              const r = await fetch(`/api/qa/${encodeURIComponent(id)}`, { cache: "no-store" });
              const j = await r.json();
              return { id, question: String(j?.question || id), summary: j?.summary ? String(j.summary) : undefined, answer: j?.answer ? String(j.answer) : undefined };
            } catch {
              return { id, question: id, summary: undefined, answer: undefined };
            }
          })
        );
        if (!active) return;
        const next = new Map(relNodes);
        for (const it of arr) next.set(it.id, it);
        setRelNodes(next);
      } catch {}
    })();
    return () => { active = false; };
  }, [qaId, JSON.stringify(edges)]);

  useEffect(() => {
    const t = setTimeout(() => { if (connectMode) void loadMine(myQ); }, 250);
    return () => clearTimeout(t);
  }, [connectMode, myQ]);

  async function loadMine(q?: string) {
    const query = (q ?? "").trim();
    const reqId = ++myReqRef.current;
    try {
      setMyLoading(true);
      myAbortRef.current?.abort();
      const controller = new AbortController();
      myAbortRef.current = controller;
      const url = `/api/qa/my${query ? `?q=${encodeURIComponent(query)}` : ""}`;
      const r = await fetch(url, { cache: "no-store", signal: controller.signal });
      const j = await r.json().catch(() => ({ items: [] }));
      if (reqId === myReqRef.current) {
        const arr: Array<{ id: string; question: string; summary?: string; helpful?: number; unhelpful?: number }> = Array.isArray(j?.items) ? j.items : [];
        setMyItems(arr);
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === "AbortError") return;
    } finally {
      if (reqId === myReqRef.current) setMyLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">질문 간 관계 편집</div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      {writerInfo && (
        <div className="rounded border p-2 bg-white/60 dark:bg-gray-900/40 text-[12px]">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate">현재 문서 · Q: {writerInfo.question}</div>
            <div className="flex items-center gap-1">
              <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => { setSrcOverrideId(writerInfo.id); setManualSource(true); }}>Src</button>
              <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => onTargetChange?.(writerInfo.id)}>Trg</button>
              <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => onEdit?.(writerInfo.id)}>편집</button>
            </div>
          </div>
          {writerInfo.createdBy && <div className="text-[10px] text-gray-500 mt-0.5">by {writerInfo.createdBy}</div>}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[11px] flex items-center gap-1">
          <input type="checkbox" checked={!!connectMode} onChange={(e) => onConnectModeChange?.(e.target.checked)} /> 연결 모드
        </label>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[11px] text-gray-600">방향</span>
          <select className="text-xs border rounded px-2 py-1" value={navDirection} onChange={(e) => onNavDirectionChange?.(e.target.value as "prev_to_current" | "current_to_prev")} title="중앙 선택 이동 시 기본 연결 방향">
            <option value="prev_to_current">이전 → 현재</option>
            <option value="current_to_prev">현재 → 이전</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-xs text-gray-600">Source</div>
        <div className="text-[12px] rounded border p-2 bg-white/60 dark:bg-gray-900/40 min-h-[40px]">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate">{srcOverrideId ? (srcOverride ? `Q: ${srcOverride.question}` : `Q: ${srcOverrideId}`) : "선택된 질문이 없습니다."}</div>
            <div className="flex items-center gap-1">
              {srcOverrideId && <button className="text-[11px] px-2 py-1 rounded border" onClick={() => onEdit?.(srcOverrideId!)}>편집</button>}
              {srcOverride && <button className="text-[11px] px-2 py-1 rounded border" onClick={() => { setSrcOverrideId(null); setManualSource(false); }}>Clear</button>}
            </div>
          </div>
          {srcOverride?.createdBy && <div className="text-[10px] text-gray-500 mt-0.5">by {srcOverride.createdBy}</div>}
        </div>
        <div className="flex items-center justify-center gap-2 my-1">
          <div className="text-[11px] text-gray-600 flex items-center gap-1">
            <span>Source</span>
            <span>→</span>
            <span>Target</span>
          </div>
          <select className="text-xs border rounded px-2 py-1" value={relType} onChange={(e) => { setRelType(e.target.value); setAutoType(false); }}>
            <option value="precedes">precedes</option>
            <option value="prerequisite">prerequisite</option>
            <option value="narrows">narrows</option>
            <option value="elaborates">elaborates</option>
            <option value="clarifies">clarifies</option>
            <option value="supports">supports</option>
            <option value="refutes">refutes</option>
            <option value="alternative">alternative</option>
          </select>
          <button className="text-xs px-3 py-2 rounded border disabled:opacity-50" disabled={!(srcOverrideId && targetId) || busy} onClick={() => void connect()}>{busy ? "Connecting..." : "Connect"}</button>
          <button className="text-xs px-3 py-2 rounded border disabled:opacity-50" disabled={!(srcOverrideId && targetId)} onClick={() => { if (targetId && srcOverrideId) { const s = targetId; const t = srcOverrideId; setSrcOverrideId(s); setManualSource(true); onTargetChange?.(t); } }}>Swap</button>
        </div>
        <div className="text-xs text-gray-600">Target</div>
        <div className="text-[12px] rounded border p-2 bg-white/60 dark:bg-gray-900/40 min-h-[40px]">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate">{target ? `Q: ${target.question}` : "좌측에서 항목의 '연결' 버튼으로 대상 선택"}</div>
            <div className="flex items-center gap-1">
              {targetId && <button className="text-[11px] px-2 py-1 rounded border" onClick={() => onEdit?.(targetId!)}>편집</button>}
              {target && <button className="text-[11px] px-2 py-1 rounded border" onClick={() => onTargetChange?.(null)}>Clear</button>}
            </div>
          </div>
          {target?.createdBy && <div className="text-[10px] text-gray-500 mt-0.5">by {target.createdBy}</div>}
        </div>
      </div>
      {pinnedItems.length > 0 && (
        <div>
          <div className="mt-2 text-xs text-gray-600">고정한 카드</div>
          <ul className="mt-1 space-y-1 max-h-60 overflow-auto">
            {pinnedItems.map((it) => (
              <li key={it.id} className={`p-2 rounded border text-xs ${targetId === it.id ? "bg-gray-50" : ""}`}>
                <div className="min-w-0">
                  <div className="truncate font-medium">Q: {it.question}</div>
                  {it.summary ? (
                    <div className="text-[10px] text-gray-600 truncate">{it.summary}</div>
                  ) : (it.answer ? (
                    <div className="text-[10px] text-gray-600 truncate">A: {it.answer}</div>
                  ) : null)}
                </div>
                <div className="mt-1 flex items-center gap-1 justify-end">
                  <button title="Set Source" className={`text-[10px] px-2 py-0.5 rounded border ${srcOverrideId === it.id ? 'bg-blue-600 text-white' : ''}`} onClick={() => { setSrcOverrideId(it.id); setManualSource(true); }}>{srcOverrideId === it.id ? "Src" : "Src"}</button>
                  <button title="Set Target" className={`text-[10px] px-2 py-0.5 rounded border ${targetId === it.id ? 'bg-blue-600 text-white' : ''}`} onClick={() => onTargetChange?.(it.id)}>{targetId === it.id ? "Trg" : "Trg"}</button>
                  <button title="Edit" className="text-[10px] px-2 py-0.5 rounded border" onClick={() => onEdit?.(it.id)}>Ed</button>
                  <button title="Unpin" className="text-[10px] px-2 py-0.5 rounded border" onClick={() => onUnpin?.(it.id)}>X</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!connectMode && (
        <div>
          <div className="mt-2 text-xs text-gray-600">내 질문에서 대상 선택</div>
          <div className="flex items-center gap-2 mt-1">
            <input
              className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
              placeholder="내 질문 검색"
              value={myQ}
              onChange={(e) => setMyQ(e.target.value)}
            />
            <button className="text-xs px-2 py-1 rounded border" onClick={() => void loadMine(myQ)}>검색</button>
          </div>
          {myLoading && <div className="text-[11px] text-gray-500 mt-1">불러오는 중…</div>}
          {!myLoading && myItems.length > 0 && (
            <ul className="mt-2 space-y-1 max-h-60 overflow-auto">
              {myItems.map((it) => (
                <li key={it.id} className={`p-2 rounded border text-xs flex items-center justify-between gap-2 ${targetId === it.id ? "bg-gray-50" : ""}`}>
                  <div className="min-w-0">
                    <div className="truncate">Q: {it.question}</div>
                    {it.summary && <div className="text-[10px] text-gray-600 truncate">{it.summary}</div>}
                  </div>
                  <button className="text-[11px] px-2 py-1 rounded border shrink-0" onClick={() => onTargetChange?.(it.id)}>{targetId === it.id ? "선택됨" : "선택"}</button>
                </li>
              ))}
            </ul>
          )}
          {!myLoading && myItems.length === 0 && myQ.trim().length > 0 && (
            <div className="text-[11px] text-gray-600 mt-1">내 질문에서 결과가 없습니다.</div>
          )}
        </div>
      )}
      {edges.length > 0 && (
        !!connectMode ? (
          <div className="space-y-2">
            <div>
              <div className="text-xs text-gray-600">연결(소스 → 현재)</div>
              {edges.filter((e) => e.targetId === qaId).length > 0 ? (
                <ul className="text-[11px] space-y-1">
                  {edges.filter((e) => e.targetId === qaId).map((e, i) => {
                    const src = relNodes.get(e.sourceId);
                    if (!src) return <li key={`in-${i}`} className="truncate">Q: {e.sourceId} · {e.type}</li>;
                    const snippet = src.summary || src.answer;
                    return (
                      <li key={`in-${i}`} className="truncate">
                        <div>Q: {src.question} · {e.type}</div>
                        {snippet && <div className="text-[10px] text-gray-600 truncate">A: {snippet}</div>}
                        <div className="mt-0.5 flex items-center gap-1 justify-end">
                          <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => onEdit?.(src.id)}>편집</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-[11px] text-gray-500">없음</div>
              )}
            </div>
            <div>
              <div className="text-xs text-gray-600">연결(현재 → 타겟)</div>
              {edges.filter((e) => e.sourceId === qaId).length > 0 ? (
                <ul className="text-[11px] space-y-1">
                  {edges.filter((e) => e.sourceId === qaId).map((e, i) => {
                    const trg = relNodes.get(e.targetId);
                    if (!trg) return <li key={`out-${i}`} className="truncate">{e.type} · Q: {e.targetId}</li>;
                    const snippet = trg.summary || trg.answer;
                    return (
                      <li key={`out-${i}`} className="truncate">
                        <div>{e.type} · Q: {trg.question}</div>
                        {snippet && <div className="text-[10px] text-gray-600 truncate">A: {snippet}</div>}
                        <div className="mt-0.5 flex items-center gap-1 justify-end">
                          <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => onEdit?.(trg.id)}>편집</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-[11px] text-gray-500">없음</div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-gray-600">
            {`연결 요약: 소스 ${edges.filter((e) => e.targetId === qaId).length} · 타겟 ${edges.filter((e) => e.sourceId === qaId).length}`}
          </div>
        )
      )}
      {!qaId && <div className="text-[11px] text-gray-600">먼저 중앙에서 Q&A를 공유해 ID를 생성하세요.</div>}
    </div>
  );
}
