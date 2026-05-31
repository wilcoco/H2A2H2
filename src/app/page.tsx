"use client";

import { useEffect, useRef, useState } from "react";
import LeftAsk from "@/components/LeftAsk";
import CenterQAViewer from "@/components/CenterQAViewer";
import CenterGraph from "@/components/CenterGraph";
import ThreadDrawer from "@/components/ThreadDrawer";
import RightWriter from "@/components/RightWriter";
import type { GraphNode, GraphEdge, Work, LlmPatch, NodeType, EdgeType } from "@/types/graph";
import AuthModal from "@/components/AuthModal";
import PublishModal from "@/components/PublishModal";
import GovernanceBar from "@/components/GovernanceBar";
import GovernanceCouncilModal from "@/components/GovernanceCouncilModal";
import DormantPanel from "@/components/DormantPanel";
import NightwishBar from "@/components/NightwishBar";

const initialWorks: Work[] = [
  {
    id: "w1",
    title: "Example Work A",
    description: "Sample public knowledge work",
    investmentScore: 42,
    nodeCount: 5,
  },
  {
    id: "w2",
    title: "Example Work B",
    description: "Another user contribution",
    investmentScore: 18,
    nodeCount: 8,
  },
];

const initialNodes: GraphNode[] = [
  { id: "n1", type: "concept", title: "Sample concept" },
  { id: "n2", type: "claim", title: "Initial claim" },
];

const initialEdges: GraphEdge[] = [];

export default function Home() {
  const [nodes, setNodes] = useState<GraphNode[]>(initialNodes);
  const [edges, setEdges] = useState<GraphEdge[]>(initialEdges);
  const [works, setWorks] = useState<Work[]>(initialWorks);
  const [selectedWorkId, setSelectedWorkId] = useState<string | undefined>();
  const [user, setUser] = useState<{ email: string; name?: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [selectedQaId, setSelectedQaId] = useState<string | null>(null);
  const [centerQuestion, setCenterQuestion] = useState<string>("");
  const [centerAiAnswer, setCenterAiAnswer] = useState<string>("");
  const [threadOpen, setThreadOpen] = useState(false);
  // relations UI removed
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const [leftThreadRootId, setLeftThreadRootId] = useState<string | null>(null);
  const [leftSelectedPath, setLeftSelectedPath] = useState<string[] | null>(null);
  // removed: defaultSourceId. Source is set explicitly from Center actions only.
  const [lastViewedQaId, setLastViewedQaId] = useState<string | null>(null);
  const [leftKeyword, setLeftKeyword] = useState<string | null>(null);
  const [leftKeywordMode, setLeftKeywordMode] = useState<"any" | "all">("any");
  const [leftKeywords, setLeftKeywords] = useState<string[] | null>(null);
  const [leftPhrases, setLeftPhrases] = useState<string[] | null>(null);
  // relations UI removed
  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [centerAiMeta, setCenterAiMeta] = useState<{ providerUsed?: "openai" | "anthropic"; modelUsed?: string; fallbackUsed?: boolean; maxTokensUsed?: number; reasoningEffortUsed?: "low" | "medium" | "high" } | null>(null);
  const [centerPrevRespId, setCenterPrevRespId] = useState<string | null>(null);
  const [centerLockContext, setCenterLockContext] = useState<boolean>(true);
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<"short" | "normal" | "long">("normal");
  const [writerQaId, setWriterQaId] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState<number>(300);
  const [rightWidth, setRightWidth] = useState<number>(420);
  const [leftTab, setLeftTab] = useState<"search" | "dormant">("search");
  const [rightTab, setRightTab] = useState<"graph" | "writer">("graph");
  const [councilOpen, setCouncilOpen] = useState(false);
  const dragRef = useRef<{ side: "left" | "right"; startX: number; startW: number } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      if (d.side === "left") {
        const next = Math.max(220, Math.min(600, d.startW + dx));
        setLeftWidth(next);
      } else {
        const next = Math.max(280, Math.min(640, d.startW - dx));
        setRightWidth(next);
      }
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);


  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ user: null }));
        if (mounted && me?.user?.email) setUser({ email: me.user.email as string, name: me.user.name });
      } catch {}
    })();
    try {
      const prov = localStorage.getItem("ai_provider");
      if (prov === "openai" || prov === "anthropic") setProvider(prov);
      const det = localStorage.getItem("ai_detail");
      if (det === "short" || det === "normal" || det === "long") setDetail(det);
    } catch {}
    return () => { mounted = false; };
  }, []);

  // removed relations nav persistence

  useEffect(() => {
    try { localStorage.setItem("ai_provider", provider); } catch {}
  }, [provider]);

  useEffect(() => {
    // Reset center chat response chain when provider changes
    setCenterPrevRespId(null);
  }, [provider]);

  useEffect(() => {
    try { localStorage.setItem("ai_detail", detail); } catch {}
  }, [detail]);

  // Load thread root for the currently selected QA so left can show thread list
  useEffect(() => {
    let active = true;
    (async () => {
      if (!selectedQaId) { if (active) setLeftThreadRootId(null); return; }
      try {
        const r = await fetch(`/api/qa/map?qaId=${encodeURIComponent(selectedQaId)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (active) setLeftThreadRootId(j?.rootId ? String(j.rootId) : null);
      } catch {
        if (active) setLeftThreadRootId(null);
      }
    })();
    return () => { active = false; };
  }, [selectedQaId, graphRefreshKey]);

  // Removed: pins hydration (relations UI removed)

  // Removed: clearing target on source change to allow auto-defaulting (prev → current)

  // Left references replaced by QA search; keep works for publish flow only.

  function suggestRelTypeForNew(newQ: string): string {
    const t = (newQ || "").toLowerCase();
    const has = (arr: string[]) => arr.some((k) => t.includes(k));
    if (has(["예:", "예시", "사례", "예를 들어", "요약", "정리", "적용", "로컬라이즈"])) return "elaborates";
    if (has(["정의", "의미", "란", "오해", "명확"])) return "clarifies";
    if (has(["먼저", "선행", "필요", "해야", "전제", "필수"])) return "prerequisite";
    if (has(["종류", "유형", "세부", "특정"])) return "narrows";
    return "precedes";
  }

  async function autoConnectCurrentToPrev(currId: string, prevId: string | null, newQ: string) {
    try {
      const trg = (prevId || "").trim();
      if (!trg || currId === trg) return;
      const type = suggestRelTypeForNew(newQ);
      await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: currId, targetId: trg, type, weight: 1 }) });
      setGraphRefreshKey((k) => k + 1);
    } catch {}
  }

  async function autoConnectPrevToCurrent(prevId: string | null, currId: string, newQ: string) {
    try {
      const src = (prevId || "").trim();
      if (!src || src === currId) return;
      const type = suggestRelTypeForNew(newQ);
      await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: src, targetId: currId, type, weight: 1 }) });
      setGraphRefreshKey((k) => k + 1);
    } catch {}
  }

  async function askAiNow(question: string) {
    try {
      setSelectedQaId(null);
      setCenterQuestion(question);
      setCenterAiAnswer("");
      setCenterAiMeta(null);
      const ctxIds = (() => {
        const base = Array.isArray(selectedContextIds) ? selectedContextIds : [];
        if (centerLockContext && lastViewedQaId) {
          return base.includes(lastViewedQaId) ? base : [lastViewedQaId, ...base];
        }
        return base;
      })();
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: question, history: [], provider, detail, previousResponseId: centerPrevRespId || undefined, contextIds: ctxIds }) });
      if (!res.ok) throw new Error("AI call failed");
      const j = await res.json();
      setCenterAiAnswer(String(j?.answer || ""));
      const providerUsed = j?.providerUsed === "openai" || j?.providerUsed === "anthropic" ? (j.providerUsed as "openai" | "anthropic") : undefined;
      const modelUsed = typeof j?.modelUsed === "string" ? j.modelUsed : undefined;
      const fallbackUsed = Boolean(j?.fallbackUsed);
      const maxTokensUsed = (() => {
        const v = j?.maxTokensUsed;
        const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
        return Number.isFinite(n) ? n : undefined;
      })();
      const reasoningEffortUsed = j?.reasoningEffortUsed;
      const reasoningEffort = reasoningEffortUsed === "low" || reasoningEffortUsed === "medium" || reasoningEffortUsed === "high" ? reasoningEffortUsed : undefined;
      setCenterAiMeta({ providerUsed, modelUsed, fallbackUsed, maxTokensUsed, reasoningEffortUsed: reasoningEffort });
      if (j?.responseId) try { setCenterPrevRespId(String(j.responseId)); } catch {}
    } catch {}
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore when typing in fields or contenteditable
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName?.toLowerCase();
      const ae = (document.activeElement as HTMLElement | null);
      const aTag = ae?.tagName?.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || tag === "select" || (!!tgt && tgt.isContentEditable) || aTag === "input" || aTag === "textarea" || aTag === "select" || (!!ae && ae.isContentEditable);
      if (isTyping) return;
      // Toggle thread drawer with 'f'
      if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setThreadOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function applyPatch(patch: LlmPatch) {
    let nextNodes = [...nodes];
    let nextEdges = [...edges];

    const removeEdgeOps = patch.ops.filter((op) => op.op === "remove_edge");
    const removeNodeOps = patch.ops.filter((op) => op.op === "remove_node");
    const addNodeOps = patch.ops.filter((op) => op.op === "add_node");
    const updateNodeOps = patch.ops.filter((op) => op.op === "update_node");
    const addEdgeOps = patch.ops.filter((op) => op.op === "add_edge");

    // 1) remove edges first
    for (const op of removeEdgeOps) {
      nextEdges = nextEdges.filter((e) => e.id !== op.id);
    }
    // 2) remove nodes (and detach their edges)
    for (const op of removeNodeOps) {
      nextNodes = nextNodes.filter((n) => n.id !== op.id);
      nextEdges = nextEdges.filter((e) => e.sourceId !== op.id && e.targetId !== op.id);
    }
    // 3) add nodes
    for (const op of addNodeOps) {
      if (!nextNodes.some((n) => n.id === op.node.id)) nextNodes.push(op.node);
    }
    // 4) update nodes
    for (const op of updateNodeOps) {
      nextNodes = nextNodes.map((n) => (n.id === op.id ? { ...n, ...op.patch } : n));
    }
    // 5) add edges (after nodes exist)
    for (const op of addEdgeOps) {
      const srcOk = nextNodes.some((n) => n.id === op.edge.sourceId);
      const dstOk = nextNodes.some((n) => n.id === op.edge.targetId);
      const dup = nextEdges.some((e) => e.id === op.edge.id);
      if (srcOk && dstOk && !dup) nextEdges.push(op.edge);
    }

    setNodes(nextNodes);
    setEdges(nextEdges);
  }

  function addNode(n: { type: NodeType; title: string; content?: string }) {
    const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const node: GraphNode = { id, type: n.type, title: n.title, content: n.content };
    setNodes((prev) => [...prev, node]);
  }

  function updateNode(id: string, patch: { title?: string; content?: string }) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }

  function removeNode(id: string) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.sourceId !== id && e.targetId !== id));
  }

  function removeEdge(id: string) {
    setEdges((prev) => prev.filter((e) => e.id !== id));
  }

  function investNode(id: string, delta: number) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, score: (n.score ?? 0) + delta } : n)));
  }

  function investEdge(id: string, delta: number) {
    setEdges((prev) => prev.map((e) => (e.id === id ? { ...e, score: (e.score ?? 0) + delta } : e)));
  }

  return (
    <div className="min-h-dvh grid grid-rows-[auto_1fr]">
      <header className="border-b border-gray-200/60 p-3 md:p-4 flex items-center justify-between">
        <h1 className="text-base font-semibold">업무 지식 편집기</h1>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-500 hidden sm:block">MVP · 3-panels</div>
          <a href="/me" className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100">내 페이지</a>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-600">Provider</span>
            <select
              className="border rounded px-2 py-1 text-xs"
              value={provider}
              onChange={(e) => setProvider(e.target.value === "anthropic" ? "anthropic" : "openai")}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
            </select>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-600">답변 레벨</span>
            <select
              className="border rounded px-2 py-1 text-xs"
              value={detail}
              onChange={(e) => {
                const v = e.target.value;
                setDetail(v === "short" ? "short" : v === "long" ? "long" : "normal");
              }}
            >
              <option value="short">간단</option>
              <option value="normal">표준</option>
              <option value="long">심화</option>
            </select>
          </div>
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-700">{user.name || user.email}</span>
              <button
                className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  setUser(null);
                }}
              >Sign out</button>
            </div>
          ) : (
            <button
              className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100"
              onClick={() => setAuthOpen(true)}
            >Sign in</button>
          )}
        </div>
      </header>
      <GovernanceBar
        refreshKey={graphRefreshKey}
        currentUserEmail={user?.email}
        onOpenCouncil={() => setCouncilOpen(true)}
        onSeededP0={(id) => { setSelectedQaId(id); setLastViewedQaId(id); setCenterAiAnswer(""); setGraphRefreshKey((k) => k + 1); }}
      />
      <GovernanceCouncilModal
        open={councilOpen}
        onClose={() => setCouncilOpen(false)}
        currentUserEmail={user?.email}
        refreshKey={graphRefreshKey}
        onChanged={() => setGraphRefreshKey((k) => k + 1)}
      />
      <div className="p-3 md:p-4 overflow-hidden flex flex-col gap-3 md:gap-4">
        <div className="overflow-hidden flex flex-col lg:flex-row gap-3 md:gap-4">
          <aside
            className="rounded border border-gray-200/60 p-0 overflow-hidden flex flex-col"
            style={{ width: leftWidth }}
          >
            <div className="flex items-center border-b border-gray-200/60">
              <button
                className={`text-xs px-3 py-2 ${leftTab === "search" ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-500 hover:text-gray-700"}`}
                onClick={() => setLeftTab("search")}
              >질문/검색</button>
              <button
                className={`text-xs px-3 py-2 ${leftTab === "dormant" ? "border-b-2 border-amber-600 text-amber-700" : "text-gray-500 hover:text-gray-700"}`}
                onClick={() => setLeftTab("dormant")}
                title="잠복한 가지를 발견하고 부활시킬 수 있어요 (갈릴레오 가지 보존)"
              >잠복 발견</button>
            </div>
            <div className="p-2 md:p-3 overflow-auto flex-1" style={{ display: leftTab === "search" ? "block" : "none" }}>
              <LeftAsk
                onSelectQA={(id) => {
                  setLastViewedQaId(id);
                  setSelectedQaId(id);
                  setCenterAiAnswer("");
                }}
                onAskAINow={(q) => void askAiNow(q)}
                refreshKey={graphRefreshKey}
                keyword={leftKeyword}
                keywordMode={leftKeywordMode}
                keywords={leftKeywords}
                phrases={leftPhrases}
                onClearKeyword={() => { setLeftKeyword(null); setLeftKeywords(null); setLeftPhrases(null); setLeftKeywordMode("any"); }}
                contextIds={selectedContextIds}
                onToggleContext={(id, next) => setSelectedContextIds((prev) => next ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id))}
                threadRootId={leftThreadRootId}
                onSelectChainPath={(path) => setLeftSelectedPath(path)}
              />
            </div>
            <div className="p-2 md:p-3 overflow-auto flex-1" style={{ display: leftTab === "dormant" ? "block" : "none" }}>
              <DormantPanel
                refreshKey={graphRefreshKey}
                onSelect={(id) => {
                  setLastViewedQaId(id);
                  setSelectedQaId(id);
                  setCenterAiAnswer("");
                  setLeftTab("search");
                }}
              />
            </div>
          </aside>
          <div
            className="hidden lg:block w-1 cursor-col-resize bg-transparent hover:bg-blue-200/50"
            onMouseDown={(e) => { dragRef.current = { side: "left", startX: e.clientX, startW: leftWidth }; }}
          />

          <main className="rounded border border-gray-200/60 p-0 overflow-hidden flex-1 min-w-0 flex flex-col">
            <div className="flex items-center border-b border-gray-200/60">
              <div className="text-xs px-3 py-2 border-b-2 border-blue-600 text-blue-700">
                {selectedQaId ? "Q&A 보기" : centerAiAnswer ? "LLM 답변 (저장하기 전)" : "LLM 대화"}
              </div>
            </div>
            <div className="p-2 md:p-3 overflow-auto flex-1">
              <CenterQAViewer
                qaId={selectedQaId || undefined}
                question={!selectedQaId ? centerQuestion : undefined}
                aiAnswer={!selectedQaId ? centerAiAnswer : undefined}
                aiProvider={!selectedQaId ? centerAiMeta?.providerUsed : undefined}
                aiModel={!selectedQaId ? centerAiMeta?.modelUsed : undefined}
                aiFallbackUsed={!selectedQaId ? centerAiMeta?.fallbackUsed : undefined}
                aiResponseId={!selectedQaId ? (centerPrevRespId || undefined) : undefined}
                aiMaxTokensUsed={!selectedQaId ? centerAiMeta?.maxTokensUsed : undefined}
                aiReasoningEffortUsed={!selectedQaId ? centerAiMeta?.reasoningEffortUsed : undefined}
                provider={provider}
                detail={detail}
                lockContext={centerLockContext}
                onToggleLock={(v) => setCenterLockContext(v)}
                onSetPrevRespId={(rid) => setCenterPrevRespId(rid)}
                onOpenThread={() => setThreadOpen(true)}
                onKeywordClick={(kw) => { setLeftKeywords(null); setLeftPhrases(null); setLeftKeyword(kw); }}
                onKeywordSearch={({ keywords, phrases, mode }) => {
                  setLeftKeywordMode(mode || "any");
                  if (phrases && phrases.length > 0) {
                    setLeftKeywords(null);
                    setLeftPhrases(phrases);
                    setLeftKeyword(phrases[0]);
                  } else if (keywords && keywords.length > 0) {
                    setLeftPhrases(null);
                    setLeftKeywords(keywords);
                    setLeftKeyword(keywords.join(" "));
                  }
                }}
                onShared={(newId: string) => {
                  setSelectedQaId(newId);
                  setCenterAiAnswer("");
                  setLastViewedQaId(newId);
                }}
                refreshKey={graphRefreshKey}
                onGraphChanged={() => setGraphRefreshKey((k) => k + 1)}
                onSelectQA={(id) => {
                  setLastViewedQaId(id);
                  setSelectedQaId(id);
                  setCenterAiAnswer("");
                }}
                currentUserEmail={user?.email}
                selectedChainPath={leftSelectedPath || undefined}
              />
            </div>
            <NightwishBar
              qaId={selectedQaId || undefined}
              rootId={leftThreadRootId || undefined}
              question={centerQuestion}
              answer={centerAiAnswer}
              signedIn={Boolean(user?.email)}
              refreshKey={graphRefreshKey}
              onForked={(id) => {
                setSelectedQaId(id);
                setCenterAiAnswer("");
                setGraphRefreshKey((k) => k + 1);
              }}
            />
          </main>
          <div
            className="hidden lg:block w-1 cursor-col-resize bg-transparent hover:bg-blue-200/50"
            onMouseDown={(e) => { dragRef.current = { side: "right", startX: e.clientX, startW: rightWidth }; }}
          />

          <aside className="rounded border border-gray-200/60 p-0 overflow-hidden flex flex-col" style={{ width: rightWidth }}>
            <div className="flex items-center border-b border-gray-200/60">
              <button
                className={`text-xs px-3 py-2 ${rightTab === "graph" ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-500 hover:text-gray-700"}`}
                onClick={() => setRightTab("graph")}
              >그래프</button>
              <button
                className={`text-xs px-3 py-2 ${rightTab === "writer" ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-500 hover:text-gray-700"}`}
                onClick={() => setRightTab("writer")}
              >문서 작성</button>
            </div>
            <div className="p-2 md:p-3 overflow-auto flex-1" style={{ display: rightTab === "graph" ? "block" : "none" }}>
              <CenterGraph
                nodes={nodes}
                edges={edges}
                onInvestNode={investNode}
                onInvestEdge={investEdge}
                onAddNode={addNode}
                onUpdateNode={updateNode}
                onRemoveNode={removeNode}
                onRemoveEdge={removeEdge}
              />
            </div>
            <div className="p-2 md:p-3 overflow-auto flex-1" style={{ display: rightTab === "writer" ? "block" : "none" }}>
              <RightWriter
                qaId={writerQaId || undefined}
                centerQaId={selectedQaId || undefined}
                centerChainIds={(leftSelectedPath && selectedQaId) ? ((leftSelectedPath.indexOf(selectedQaId) >= 0) ? leftSelectedPath.slice(leftSelectedPath.indexOf(selectedQaId)) : leftSelectedPath) : (selectedQaId ? [selectedQaId] : undefined)}
                currentUserEmail={user?.email || null}
                refreshKey={graphRefreshKey}
                onSetQaId={(id: string) => setWriterQaId(id)}
                onSaved={() => {
                  setGraphRefreshKey((k) => k + 1);
                }}
                aiQuestion={!selectedQaId ? centerQuestion : undefined}
                aiAnswer={!selectedQaId ? centerAiAnswer : undefined}
              />
            </div>
          </aside>
          </div>
        </div>
      <ThreadDrawer qaId={selectedQaId || undefined} open={threadOpen} onClose={() => setThreadOpen(false)} provider={provider} detail={detail} />
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignedIn={(u) => setUser(u)}
      />
      <PublishModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onPublish={async (title: string, description?: string, topic?: string, isPublic?: boolean) => {
          try {
            const res = await fetch("/api/works", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title, description, topic, isPublic, graph: { nodes, edges } }),
            });
            if (res.ok) {
              const json = await res.json();
              if (json?.work) setWorks((prev) => [json.work as Work, ...prev]);
            } else {
              const id = `w_${Date.now()}`;
              const work: Work = {
                id,
                title: title.trim() || "Untitled",
                description: description?.trim() || undefined,
                investmentScore: 0,
                nodeCount: nodes.length,
                topic: topic?.trim() || undefined,
                isPublic: isPublic ?? true,
              };
              setWorks((prev) => [work, ...prev]);
            }
          } finally {
            setPublishOpen(false);
          }
        }}
      />
    </div>
  );
}
