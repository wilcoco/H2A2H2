"use client";

import { useEffect, useState } from "react";
import LeftAsk from "@/components/LeftAsk";
import CenterQAViewer from "@/components/CenterQAViewer";
import ThreadDrawer from "@/components/ThreadDrawer";
import RightRelations from "@/components/RightRelations";
import type { GraphNode, GraphEdge, Work, LlmPatch, NodeType, EdgeType } from "@/types/graph";
import AuthModal from "@/components/AuthModal";
import PublishModal from "@/components/PublishModal";

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
  const [connectMode, setConnectMode] = useState(false);
  const [relTargetId, setRelTargetId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const [defaultSourceId, setDefaultSourceId] = useState<string | null>(null);
  const [lastViewedQaId, setLastViewedQaId] = useState<string | null>(null);
  const [leftKeyword, setLeftKeyword] = useState<string | null>(null);
  const [leftKeywordMode, setLeftKeywordMode] = useState<"any" | "all">("any");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ user: null }));
        if (mounted && me?.user?.email) setUser({ email: me.user.email as string, name: me.user.name });
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  // Hydrate pins when user changes
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!user?.email) { if (active) setPinnedIds([]); return; }
        const r = await fetch("/api/qa/pin", { cache: "no-store" });
        if (!r.ok) { if (active) setPinnedIds([]); return; }
        const j = await r.json();
        const ids: string[] = Array.isArray(j?.ids) ? j.ids : [];
        if (active) setPinnedIds(ids);
      } catch { if (active) setPinnedIds([]); }
    })();
    return () => { active = false; };
  }, [user?.email]);

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
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: question, history: [] }) });
      if (!res.ok) throw new Error("AI call failed");
      const j = await res.json();
      setCenterAiAnswer(String(j?.answer || ""));
    } catch {}
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore when typing in fields or contenteditable
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName?.toLowerCase();
      const ae = (document.activeElement as HTMLElement | null);
      const aTag = ae?.tagName?.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || tag === "select" || (!!tgt && (tgt as any).isContentEditable) || aTag === "input" || aTag === "textarea" || aTag === "select" || (!!ae && (ae as any).isContentEditable);
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
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-700">{user.name || user.email}</span>
              <button
                className="text-xs px-2 py-1 rounded border border-blue-600 text-blue-700 hover:bg-blue-50"
                onClick={() => setPublishOpen(true)}
              >Publish</button>
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
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_360px] gap-3 md:gap-4 p-3 md:p-4 overflow-hidden">
        <aside className="rounded border border-gray-200/60 p-3 md:p-3 overflow-auto">
          <LeftAsk
            onSelectQA={(id) => { setLastViewedQaId(id); setSelectedQaId(id); setCenterAiAnswer(""); }}
            onAskAINow={(q) => void askAiNow(q)}
            connectMode={connectMode}
            targetId={relTargetId}
            onPickTarget={(id) => setRelTargetId(id)}
            refreshKey={graphRefreshKey}
            keyword={leftKeyword}
            keywordMode={leftKeywordMode}
            onClearKeyword={() => setLeftKeyword(null)}
          />
        </aside>

        <main className="rounded border border-gray-200/60 p-2 md:p-3 overflow-auto">
          <CenterQAViewer
            qaId={selectedQaId || undefined}
            question={!selectedQaId ? centerQuestion : undefined}
            aiAnswer={!selectedQaId ? centerAiAnswer : undefined}
            onOpenThread={() => setThreadOpen(true)}
            onKeywordClick={(kw) => { setLeftKeyword(kw); }}
            onShared={(newId: string) => {
              const prev = selectedQaId || lastViewedQaId;
              if (prev) setDefaultSourceId(prev);
              else {
                const fallback = (pinnedIds || []).find((x) => x && x !== newId) || null;
                if (fallback) setDefaultSourceId(fallback);
              }
              setSelectedQaId(newId);
              setCenterAiAnswer("");
              setRelTargetId(newId);
              // Update last viewed to the new one after defaulting
              setLastViewedQaId(newId);
              // Auto-connect previous → current for visibility in Center panel
              void autoConnectPrevToCurrent(prev ?? null, newId, centerQuestion);
            }}
            onPinned={async (id: string) => {
              setPinnedIds((prev) => (prev.includes(id) ? prev : [id, ...prev]));
              try { await fetch("/api/qa/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId: id }) }); } catch {}
            }}
            refreshKey={graphRefreshKey}
            onSelectQA={(id) => { setLastViewedQaId(id); setSelectedQaId(id); setCenterAiAnswer(""); }}
            currentUserEmail={user?.email}
          />
        </main>

        <aside className="rounded border border-gray-200/60 p-2 md:p-3 overflow-auto">
          <RightRelations
            qaId={selectedQaId || undefined}
            targetId={relTargetId}
            onTargetChange={(id) => setRelTargetId(id)}
            connectMode={connectMode}
            onConnectModeChange={(v) => setConnectMode(v)}
            defaultSourceId={defaultSourceId}
            pinnedIds={pinnedIds}
            onUnpin={async (id) => {
              setPinnedIds((prev) => prev.filter((x) => x !== id));
              try { await fetch("/api/qa/pin", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId: id }) }); } catch {}
            }}
            onGraphChanged={() => setGraphRefreshKey((k) => k + 1)}
          />
        </aside>
      </div>
      <ThreadDrawer qaId={selectedQaId || undefined} open={threadOpen} onClose={() => setThreadOpen(false)} />
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
