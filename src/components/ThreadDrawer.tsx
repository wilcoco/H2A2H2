"use client";

import { useEffect, useState } from "react";

type ThreadNode = {
  id: string;
  parentId?: string;
  question: string;
  hasAnswer: boolean;
  helpful: number;
  unhelpful: number;
  myVote: number;
  children: ThreadNode[];
};

type Props = {
  qaId?: string;
  open: boolean;
  onClose: () => void;
};

export default function ThreadDrawer({ qaId, open, onClose }: Props) {
  const [rootId, setRootId] = useState<string | null>(null);
  const [tree, setTree] = useState<ThreadNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followupText, setFollowupText] = useState<Record<string, string>>({});
  const [busyVote, setBusyVote] = useState<Record<string, boolean>>({});
  const [intentL1, setIntentL1] = useState<Record<string, string>>({});
  const [intentL2, setIntentL2] = useState<Record<string, string>>({});
  const [targetPIC, setTargetPIC] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"thread" | "map">("thread");
  const [mLoading, setMLoading] = useState(false);
  const [mError, setMError] = useState<string | null>(null);
  const [mNodes, setMNodes] = useState<Array<{ id: string; question: string; hasAnswer: boolean; helpful: number; unhelpful: number; myVote: number }>>([]);
  const [mEdges, setMEdges] = useState<Array<{ sourceId: string; targetId: string; type: string; weight: number; synthetic?: boolean }>>([]);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [relType, setRelType] = useState<string>("follows_from");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let mounted = true;
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
    return () => { mounted = false; };
  }, [open, qaId]);

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

  async function addFollowup(parentId: string) {
    try {
      const text = (followupText[parentId] || "").trim();
      if (!text) return;
      const l1 = (intentL1[parentId] || "").trim() || undefined;
      const l2 = (intentL2[parentId] || "").trim() || undefined;
      const pic = (targetPIC[parentId] || "").trim() || undefined;
      const res = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, parentId, intentL1: l1, intentL2: l2, targetPIC: pic }) });
      if (!res.ok) throw new Error("Share failed");
      setFollowupText((m) => ({ ...m, [parentId]: "" }));
      await refresh();
    } catch {}
  }

  async function aiAnswer(id: string, q: string) {
    try {
      const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: q, history: [] }) });
      if (!r.ok) throw new Error("AI failed");
      const j = await r.json();
      const answer = String(j?.answer || "");
      if (!answer) return;
      const u = await fetch("/api/qa/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId: id, answer }) });
      if (!u.ok) throw new Error("Save failed");
      await refresh();
    } catch {}
  }

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
    if (!s || !t || !ty || s === t) return;
    try {
      setConnecting(true);
      const r = await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: s, targetId: t, type: ty, weight: 1 }) });
      if (!r.ok) throw new Error("Connect failed");
      setFromId(null); setToId(null);
      await loadMap();
    } catch {}
    finally { setConnecting(false); }
  }

  function NodeItem({ node }: { node: ThreadNode }) {
    const fid = node.id;
    const fval = followupText[fid] || "";
    return (
      <div className="border-l pl-3 ml-1 my-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">Q: {node.question}</div>
            <div className="text-[11px] text-gray-600 mt-0.5">{node.hasAnswer ? "답변 있음" : "미답변"}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button className="text-[11px] px-2 py-1 rounded border" disabled={!!busyVote[fid]} onClick={() => void sendVote(fid, 1)}>Helpful ({node.helpful})</button>
            <button className="text-[11px] px-2 py-1 rounded border" disabled={!!busyVote[fid]} onClick={() => void sendVote(fid, -1)}>Not ({node.unhelpful})</button>
            {!node.hasAnswer && (
              <button className="text-[11px] px-2 py-1 rounded border" onClick={() => void aiAnswer(fid, node.question)}>AI 답변 생성</button>
            )}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2">
          <div className="flex items-center gap-2">
            <select
              className="text-[11px] border rounded px-2 py-1"
              value={intentL1[fid] || ""}
              onChange={(e) => setIntentL1((m) => ({ ...m, [fid]: e.target.value }))}
            >
              <option value="">L1(담화관계)</option>
              <option value="expansion">expansion</option>
              <option value="contingency">contingency</option>
              <option value="comparison">comparison</option>
              <option value="temporal">temporal</option>
              <option value="evidence">evidence</option>
              <option value="evaluation">evaluation</option>
            </select>
            <select
              className="text-[11px] border rounded px-2 py-1"
              value={intentL2[fid] || "clarify"}
              onChange={(e) => setIntentL2((m) => ({ ...m, [fid]: e.target.value }))}
            >
              <option value="clarify">clarify</option>
              <option value="detail">detail</option>
              <option value="example">example</option>
              <option value="justify">justify</option>
              <option value="verify">verify</option>
              <option value="compare">compare</option>
              <option value="alternative">alternative</option>
              <option value="adapt">adapt</option>
              <option value="localize">localize</option>
              <option value="implement">implement</option>
              <option value="troubleshoot">troubleshoot</option>
              <option value="summarize">summarize</option>
              <option value="plan">plan</option>
              <option value="risk">risk</option>
              <option value="metrics">metrics</option>
              <option value="reframe">reframe</option>
            </select>
            <select
              className="text-[11px] border rounded px-2 py-1"
              value={targetPIC[fid] || ""}
              onChange={(e) => setTargetPIC((m) => ({ ...m, [fid]: e.target.value }))}
            >
              <option value="">Target</option>
              <option value="premise">premise</option>
              <option value="inference">inference</option>
              <option value="conclusion">conclusion</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded border border-gray-300 bg-white/90 p-1 text-xs dark:bg-gray-900/60"
              placeholder="후속 질문 추가"
              value={fval}
              onChange={(e) => setFollowupText((m) => ({ ...m, [fid]: e.target.value }))}
            />
            <button className="text-[11px] px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={!fval.trim()} onClick={() => void addFollowup(fid)}>추가</button>
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
                    <option value="follows_from">follows_from</option>
                    <option value="refines">refines</option>
                    <option value="clarifies">clarifies</option>
                    <option value="depends_on">depends_on</option>
                    <option value="alternative">alternative</option>
                  </select>
                  <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={!fromId || !toId || connecting} onClick={() => void connect()}>{connecting ? "Connecting..." : "Connect"}</button>
                  {(fromId || toId) && (
                    <button className="text-xs px-2 py-1 rounded border" onClick={() => { setFromId(null); setToId(null); }}>Reset</button>
                  )}
                </div>
                <div className="text-[11px] text-gray-600">노드 선택: 먼저 From, 그다음 To 선택</div>
                <ul className="space-y-1">
                  {mNodes.map((n) => (
                    <li key={n.id} className="p-2 border rounded flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium line-clamp-1">{n.question}</div>
                        <div className="text-[10px] text-gray-500">Helpful {n.helpful} · {n.hasAnswer ? "답변 있음" : "미답변"}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button className={`text-[11px] px-2 py-1 rounded border ${fromId === n.id ? "bg-gray-100" : ""}`} onClick={() => setFromId(n.id)}>From</button>
                        <button className={`text-[11px] px-2 py-1 rounded border ${toId === n.id ? "bg-gray-100" : ""}`} onClick={() => setToId(n.id)}>To</button>
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
