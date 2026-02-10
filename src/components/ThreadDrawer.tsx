"use client";

import { useEffect, useState } from "react";

type ThreadNode = {
  id: string;
  parentId?: string;
  question: string;
  hasAnswer: boolean;
  lastResponseId?: string;
  helpful: number;
  unhelpful: number;
  myVote: number;
  children: ThreadNode[];
};

type Props = {
  qaId?: string;
  open: boolean;
  onClose: () => void;
  provider?: "openai" | "anthropic";
  detail?: "short" | "normal" | "long";
};

export default function ThreadDrawer({ qaId, open, onClose, provider: providerProp, detail: detailProp }: Props) {
  const [rootId, setRootId] = useState<string | null>(null);
  const [tree, setTree] = useState<ThreadNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyVote, setBusyVote] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"thread" | "map">("thread");
  const [mLoading, setMLoading] = useState(false);
  const [mError, setMError] = useState<string | null>(null);
  const [mNodes, setMNodes] = useState<Array<{ id: string; question: string; hasAnswer: boolean; helpful: number; unhelpful: number; myVote: number }>>([]);
  const [mEdges, setMEdges] = useState<Array<{ sourceId: string; targetId: string; type: string; weight: number; synthetic?: boolean }>>([]);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [relType, setRelType] = useState<string>("precedes");
  const [connecting, setConnecting] = useState(false);
  const [relSuggestBusy, setRelSuggestBusy] = useState(false);
  const [relSuggestError, setRelSuggestError] = useState<string | null>(null);
  const [relSuggest, setRelSuggest] = useState<{
    sourceId: string;
    targetId: string;
    type: string;
    confidence: number;
    rationale: string;
    providerUsed?: "openai" | "anthropic" | "fallback";
    modelUsed?: string;
  } | null>(null);
  const [provider, setProvider] = useState<"openai" | "anthropic">(providerProp ?? "openai");
  const [detail, setDetail] = useState<"short" | "normal" | "long">(detailProp ?? "normal");
  const [prevRespId, setPrevRespId] = useState<string | null>(null);
  const [lastAiMeta, setLastAiMeta] = useState<Record<string, { maxTokensUsed?: number; reasoningEffortUsed?: "low" | "medium" | "high" }>>({});

  useEffect(() => {
    async function load() {
      if (!open || !qaId) { setRootId(null); setTree(null); return; }
      try {
        setLoading(true); setError(null);
        const r = await fetch(`/api/qa/${encodeURIComponent(qaId)}`);
        if (!r.ok) throw new Error("Failed to load QA detail");
        const d = await r.json();
        const rid: string = d?.rootId || d?.id;
        setRootId(rid);
        const t = await fetch(`/api/qa/thread?rootId=${encodeURIComponent(rid)}&depth=3`, { cache: "no-store" });
        if (!t.ok) throw new Error("Failed to load thread");
        const tj = await t.json();
        setTree(tj?.root ?? null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally { setLoading(false); }
    }
    void load();
    return () => {};
  }, [open, qaId]);

  useEffect(() => {
    if (providerProp) setProvider(providerProp);
    if (detailProp) setDetail(detailProp);
  }, [providerProp, detailProp]);

  useEffect(() => {
    setLastAiMeta({});
  }, [open, qaId]);

  useEffect(() => {
    setFromId(null);
    setToId(null);
    setRelSuggest(null);
    setRelSuggestError(null);
  }, [open, qaId]);

  useEffect(() => {
    if (providerProp || detailProp) return;
    try {
      const saved = localStorage.getItem("ai_provider");
      if (saved === "openai" || saved === "anthropic") setProvider(saved);
      const det = localStorage.getItem("ai_detail");
      if (det === "short" || det === "normal" || det === "long") setDetail(det);
    } catch {}
  }, [providerProp, detailProp]);

  useEffect(() => {
    if (tab === "map") void loadMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, rootId]);

  async function sendVote(qaId: string, v: 1 | -1) {
    try {
      setBusyVote((m) => ({ ...m, [qaId]: true }));
      const res = await fetch("/api/qa/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, vote: v }) });
      if (!res.ok) throw new Error("Vote failed");
      if (rootId) await refresh();
    } catch {}
    finally { setBusyVote((m) => ({ ...m, [qaId]: false })); }
  }


  async function aiAnswer(id: string, q: string) {
    try {
      const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: q, history: [], provider, detail, previousResponseId: prevRespId || undefined }) });
      if (!r.ok) throw new Error("AI failed");
      const j = await r.json();
      if (j?.responseId) try { setPrevRespId(String(j.responseId)); } catch {}
      const maxTokensUsed = (() => {
        const v = j?.maxTokensUsed;
        const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
        return Number.isFinite(n) ? n : undefined;
      })();
      const reasoningEffortUsed = (() => {
        const v = j?.reasoningEffortUsed;
        return v === "low" || v === "medium" || v === "high" ? v : undefined;
      })();
      setLastAiMeta((m) => ({ ...m, [id]: { maxTokensUsed, reasoningEffortUsed } }));
      const answer = String(j?.answer || "");
      if (!answer) return;
      const u = await fetch("/api/qa/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId: id, answer, responseId: j?.responseId || undefined }) });
      if (!u.ok) throw new Error("Save failed");
      await refresh();
    } catch {}
  }

  useEffect(() => {
    if (providerProp || detailProp) return;
    function onStorage(e: StorageEvent) {
      if (e.key === "ai_provider") {
        const v = e.newValue || "";
        if (v === "openai" || v === "anthropic") setProvider(v);
      }
      if (e.key === "ai_detail") {
        const v = e.newValue || "";
        if (v === "short" || v === "normal" || v === "long") setDetail(v);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [providerProp, detailProp]);

  async function refresh() {
    if (!rootId) return;
    try {
      setLoading(true);
      const t = await fetch(`/api/qa/thread?rootId=${encodeURIComponent(rootId)}&depth=3`, { cache: "no-store" });
      if (!t.ok) throw new Error("Failed to load thread");
      const tj = await t.json();
      setTree(tj?.root ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }

  async function loadMap() {
    if (!rootId) return;
    try {
      setMLoading(true); setMError(null);
      const r = await fetch(`/api/qa/map?rootId=${encodeURIComponent(rootId)}`, { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to load map");
      const j = await r.json();
      setMNodes(Array.isArray(j?.nodes) ? j.nodes : []);
      setMEdges(Array.isArray(j?.edges) ? j.edges : []);
    } catch (e: unknown) {
      setMError(e instanceof Error ? e.message : "Unknown error");
    } finally { setMLoading(false); }
  }

  async function connect() {
    const s = fromId?.trim();
    const t = toId?.trim();
    const ty = relType.trim();
    if (!s || !t || !ty) return;
    if (s === t) {
      setRelSuggestError("From/To가 동일합니다.");
      return;
    }
    try {
      setConnecting(true);
      setRelSuggestError(null);
      const r = await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: s, targetId: t, type: ty, weight: 1 }) });
      if (!r.ok) {
        const j: unknown = await r.json().catch(() => ({}));
        const err = (j && typeof j === "object" && "error" in j) ? (j as { error?: unknown }).error : undefined;
        throw new Error(typeof err === "string" ? err : "Connect failed");
      }
      setFromId(null); setToId(null);
      setRelSuggest(null);
      setRelSuggestError(null);
      await loadMap();
    } catch (e: unknown) {
      setRelSuggestError(e instanceof Error ? e.message : "Connect failed");
    }
    finally { setConnecting(false); }
  }

  async function suggestRelation() {
    const aId = fromId?.trim();
    const bId = toId?.trim();
    if (!aId || !bId) return;
    if (aId === bId) {
      setRelSuggest(null);
      setRelSuggestError("From/To가 동일합니다.");
      return;
    }
    try {
      setRelSuggestBusy(true);
      setRelSuggestError(null);
      const r = await fetch("/api/qa/relation/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aId, bId, provider }),
      });
      const raw = await r.text().catch(() => "");
      const j: unknown = (() => {
        try {
          return raw ? JSON.parse(raw) : {};
        } catch {
          return {};
        }
      })();
      const jo: Record<string, unknown> = (j && typeof j === "object") ? (j as Record<string, unknown>) : {};
      if (!r.ok) {
        const err = "error" in jo ? jo.error : undefined;
        const msg = typeof err === "string" ? err : raw.trim() ? raw.trim().slice(0, 220) : `Suggest failed (${r.status})`;
        throw new Error(msg);
      }
      const sourceId = String(jo.sourceId || "");
      const targetId = String(jo.targetId || "");
      const type = String(jo.type || "");
      const confidenceRaw = typeof jo.confidence === "number" ? jo.confidence : typeof jo.confidence === "string" ? Number(jo.confidence) : NaN;
      const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
      const rationale = String(jo.rationale || "");
      const providerUsed = (jo.providerUsed === "openai" || jo.providerUsed === "anthropic" || jo.providerUsed === "fallback") ? (jo.providerUsed as "openai" | "anthropic" | "fallback") : undefined;
      const modelUsed = typeof jo.modelUsed === "string" ? jo.modelUsed : undefined;
      if (!sourceId || !targetId || !type) throw new Error("Invalid suggestion");
      setRelSuggest({ sourceId, targetId, type, confidence, rationale, providerUsed, modelUsed });
    } catch (e: unknown) {
      setRelSuggest(null);
      setRelSuggestError(e instanceof Error ? e.message : "Suggest failed");
    } finally {
      setRelSuggestBusy(false);
    }
  }

  function titleOf(id: string): string {
    const q = mNodes.find((n) => n.id === id)?.question || id;
    const t = String(q || "").replace(/\s+/g, " ").trim();
    if (t.length <= 80) return t;
    return t.slice(0, 79) + "…";
  }

  function NodeItem({ node }: { node: ThreadNode }) {
    const fid = node.id;
    const meta = lastAiMeta[fid];
    return (
      <div className="border-l pl-3 ml-1 my-2 w-full min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">Q: {node.question}</div>
            <div className="text-[11px] text-gray-600 mt-0.5">
              {node.hasAnswer ? "답변 있음" : "미답변"}
              {node.lastResponseId ? ` · RID: ${node.lastResponseId}` : ""}
              {typeof meta?.maxTokensUsed === "number" ? ` · maxTokens: ${meta.maxTokensUsed}` : ""}
              {meta?.reasoningEffortUsed ? ` · effort: ${meta.reasoningEffortUsed}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button className="text-[11px] px-2 py-1 rounded border" disabled={!!busyVote[fid]} onClick={() => void sendVote(fid, 1)}>도움됨 ({node.helpful})</button>
            <button className="text-[11px] px-2 py-1 rounded border" disabled={!!busyVote[fid]} onClick={() => void sendVote(fid, -1)}>도움 안됨 ({node.unhelpful})</button>
            {!node.hasAnswer && (
              <button className="text-[11px] px-2 py-1 rounded border" onClick={() => void aiAnswer(fid, node.question)}>AI 답변 생성</button>
            )}
          </div>
        </div>
        {node.children?.length > 0 && (
          <div className="mt-2">
            {node.children.map((ch) => (<NodeItem key={ch.id} node={ch} />))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`fixed inset-y-0 right-0 w-full sm:w-[420px] transform ${open ? "translate-x-0" : "translate-x-full"} transition-transform duration-200 z-40`}>
      <div className="h-full bg-white dark:bg-gray-900 border-l border-gray-200/60 flex flex-col">
        <div className="p-2 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button className={`text-xs px-2 py-1 rounded border ${tab === "thread" ? "bg-gray-100" : ""}`} onClick={() => setTab("thread")}>Thread</button>
            <button className={`text-xs px-2 py-1 rounded border ${tab === "map" ? "bg-gray-100" : ""}`} onClick={() => setTab("map")}>Map</button>
          </div>
          <div className="flex items-center gap-2">
            {tab === "thread" ? (
              <button className="text-xs px-2 py-1 rounded border" onClick={() => void refresh()}>Refresh</button>
            ) : (
              <button className="text-xs px-2 py-1 rounded border" onClick={() => void loadMap()}>Refresh</button>
            )}
            <button className="text-xs px-2 py-1 rounded border" onClick={onClose}>Close (F)</button>
          </div>
        </div>
        {tab === "thread" ? (
          <div className="p-2 overflow-auto flex-1">
            {loading && <div className="text-xs text-gray-500">불러오는 중...</div>}
            {error && <div className="text-xs text-red-600">{error}</div>}
            {!loading && !error && tree && <NodeItem node={tree} />}
            {!loading && !error && !tree && <div className="text-xs text-gray-500">스레드가 없습니다.</div>}
          </div>
        ) : (
          <div className="p-2 overflow-auto flex-1">
            {mLoading && <div className="text-xs text-gray-500">맵 불러오는 중...</div>}
            {mError && <div className="text-xs text-red-600">{mError}</div>}
            {!mLoading && !mError && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <select className="text-xs border rounded px-2 py-1" value={relType} onChange={(e) => setRelType(e.target.value)}>
                    <option value="precedes">precedes</option>
                    <option value="prerequisite">prerequisite</option>
                    <option value="narrows">narrows</option>
                    <option value="elaborates">elaborates</option>
                    <option value="clarifies">clarifies</option>
                    <option value="supports">supports</option>
                    <option value="refutes">refutes</option>
                    <option value="alternative">alternative</option>
                  </select>
                  <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={!fromId || !toId || fromId === toId || relSuggestBusy} onClick={() => void suggestRelation()}>{relSuggestBusy ? "추천 중…" : "AI 추천"}</button>
                  <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={!fromId || !toId || fromId === toId || connecting} onClick={() => void connect()}>{connecting ? "Connecting..." : "Connect"}</button>
                  {(fromId || toId) && (
                    <button className="text-xs px-2 py-1 rounded border" onClick={() => { setFromId(null); setToId(null); setRelSuggest(null); setRelSuggestError(null); }}>Reset</button>
                  )}
                </div>
                {relSuggestError && <div className="text-[11px] text-red-600">{relSuggestError}</div>}
                {relSuggest && (
                  <div className="p-2 border rounded bg-white/60 dark:bg-gray-900/40 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold">AI 추천</div>
                      <button className="text-[11px] px-2 py-0.5 rounded border" onClick={() => { setRelSuggest(null); setRelSuggestError(null); }}>닫기</button>
                    </div>
                    <div className="mt-1 text-gray-700">
                      {relSuggest.sourceId} → {relSuggest.targetId} · {relSuggest.type}
                      {Number.isFinite(relSuggest.confidence) ? ` · ${Math.round(relSuggest.confidence * 100)}%` : ""}
                    </div>
                    <div className="mt-1 text-[10px] text-gray-600">
                      <div className="line-clamp-2">From: {titleOf(relSuggest.sourceId)}</div>
                      <div className="line-clamp-2">To: {titleOf(relSuggest.targetId)}</div>
                    </div>
                    {relSuggest.rationale && <div className="mt-1 text-[10px] text-gray-600 whitespace-pre-wrap break-words">{relSuggest.rationale}</div>}
                    <div className="mt-1 text-[10px] text-gray-500">
                      {relSuggest.providerUsed ? `provider: ${relSuggest.providerUsed}` : ""}
                      {relSuggest.modelUsed ? ` · model: ${relSuggest.modelUsed}` : ""}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
                        disabled={connecting}
                        onClick={() => {
                          setRelType(relSuggest.type);
                          setFromId(relSuggest.sourceId);
                          setToId(relSuggest.targetId);
                        }}
                      >적용</button>
                    </div>
                  </div>
                )}
                <div className="text-[11px] text-gray-600">노드 선택: 먼저 From, 그다음 To 선택</div>
                <ul className="space-y-1">
                  {mNodes.map((n) => (
                    <li key={n.id} className="p-2 border rounded flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium line-clamp-1">{n.question}</div>
                        <div className="text-[10px] text-gray-500">도움됨 {n.helpful} · {n.hasAnswer ? "답변 있음" : "미답변"}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button className={`text-[11px] px-2 py-1 rounded border ${fromId === n.id ? "bg-gray-100" : ""}`} onClick={() => { setFromId(n.id); setRelSuggest(null); setRelSuggestError(null); }}>From</button>
                        <button className={`text-[11px] px-2 py-1 rounded border ${toId === n.id ? "bg-gray-100" : ""}`} onClick={() => { setToId(n.id); setRelSuggest(null); setRelSuggestError(null); }}>To</button>
                      </div>
                    </li>
                  ))}
                </ul>
                {mEdges.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs font-semibold mb-1">Existing relations</div>
                    <ul className="space-y-1">
                      {mEdges.slice(0, 20).map((e, i) => (
                        <li key={i} className="text-[11px] text-gray-700">{e.sourceId} → {e.targetId} · {e.type}{e.synthetic ? " (auto)" : ""}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
