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
};

export default function RightRelations({ qaId, targetId, onTargetChange, connectMode, onConnectModeChange, pinnedIds = [], onUnpin }: Props) {
  const [relType, setRelType] = useState<string>("follows_from");
  const [busy, setBusy] = useState(false);
  const [edges, setEdges] = useState<Array<{ sourceId: string; targetId: string; type: string; synthetic?: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<{ id: string; question: string } | null>(null);
  const [target, setTarget] = useState<{ id: string; question: string } | null>(null);
  const [myQ, setMyQ] = useState("");
  const [myLoading, setMyLoading] = useState(false);
  const [myItems, setMyItems] = useState<Array<{ id: string; question: string; summary?: string; helpful?: number; unhelpful?: number }>>([]);
  const myReqRef = useRef(0);
  const myAbortRef = useRef<AbortController | null>(null);
  const [pinnedItems, setPinnedItems] = useState<Array<{ id: string; question: string; summary?: string }>>([]);

  useEffect(() => { setError(null); }, [qaId]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!qaId) { if (active) setSource(null); return; }
      try {
        const r = await fetch(`/api/qa/${encodeURIComponent(qaId)}`, { cache: "no-store" });
        const j = await r.json();
        if (active) setSource({ id: qaId, question: String(j?.question || "") });
      } catch { if (active) setSource(null); }
    })();
    return () => { active = false; };
  }, [qaId]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!targetId) { if (active) setTarget(null); return; }
      try {
        const r = await fetch(`/api/qa/${encodeURIComponent(targetId)}`, { cache: "no-store" });
        const j = await r.json();
        if (active) setTarget({ id: targetId, question: String(j?.question || "") });
      } catch { if (active) setTarget(null); }
    })();
    return () => { active = false; };
  }, [targetId]);

  async function connect() {
    if (!qaId || !targetId || !relType) return;
    try {
      setBusy(true); setError(null);
      const res = await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: qaId, targetId, type: relType, weight: 1 }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Connect failed");
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
              return { id, question: String(j?.question || id), summary: j?.summary ? String(j.summary) : undefined };
            } catch {
              return { id, question: id };
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
      onTargetChange?.(null);
      setTarget(null);
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
    } catch (e: any) {
      if (e?.name === "AbortError") return;
    } finally {
      if (reqId === myReqRef.current) setMyLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">질문 간 관계 편집</div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[11px] flex items-center gap-1">
          <input type="checkbox" checked={!!connectMode} onChange={(e) => onConnectModeChange?.(e.target.checked)} /> 연결 모드
        </label>
        <select className="text-xs border rounded px-2 py-1" value={relType} onChange={(e) => setRelType(e.target.value)}>
          <option value="follows_from">follows_from</option>
          <option value="refines">refines</option>
          <option value="clarifies">clarifies</option>
          <option value="depends_on">depends_on</option>
          <option value="alternative">alternative</option>
        </select>
        <button className="text-xs px-3 py-2 rounded border disabled:opacity-50" disabled={!qaId || !targetId || busy} onClick={() => void connect()}>{busy ? "Connecting..." : "Connect"}</button>
      </div>
      <div className="space-y-2">
        <div className="text-xs text-gray-600">Source</div>
        <div className="text-[12px] rounded border p-2 bg-white/60 dark:bg-gray-900/40 min-h-[40px]">{source ? (<div className="truncate">Q: {source.question}</div>) : ("선택된 질문이 없습니다.")}</div>
        <div className="text-xs text-gray-600">Target</div>
        <div className="text-[12px] rounded border p-2 bg-white/60 dark:bg-gray-900/40 min-h-[40px] flex items-center justify-between gap-2">
          <div className="truncate">{target ? `Q: ${target.question}` : "좌측에서 항목의 '연결' 버튼으로 대상 선택"}</div>
          {target && <button className="text-[11px] px-2 py-1 rounded border" onClick={() => onTargetChange?.(null)}>Clear</button>}
        </div>
      </div>
      {pinnedItems.length > 0 && (
        <div>
          <div className="mt-2 text-xs text-gray-600">고정한 카드</div>
          <ul className="mt-1 space-y-1 max-h-60 overflow-auto">
            {pinnedItems.map((it) => (
              <li key={it.id} className={`p-2 rounded border text-xs flex items-center justify-between gap-2 ${targetId === it.id ? "bg-gray-50" : ""}`}>
                <div className="min-w-0">
                  <div className="truncate">Q: {it.question}</div>
                  {it.summary && <div className="text-[10px] text-gray-600 truncate">{it.summary}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="text-[11px] px-2 py-1 rounded border" onClick={() => onTargetChange?.(it.id)}>{targetId === it.id ? "선택됨" : "선택"}</button>
                  <button className="text-[11px] px-2 py-1 rounded border" onClick={() => onUnpin?.(it.id)}>해제</button>
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
