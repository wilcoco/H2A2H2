"use client";

import { useEffect, useState } from "react";
import LeftPanel from "@/components/LeftPanel";
import CenterGraph from "@/components/CenterGraph";
import RightChat from "@/components/RightChat";
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

  // Left references will be populated only when RightChat triggers a search

  async function searchReferences(query: string) {
    try {
      const kres = await fetch("/api/ai/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query, max: 6 }),
      });
      const kj = await kres.json().catch(() => ({ keywords: [] }));
      const kws: string[] = Array.isArray(kj?.keywords) ? kj.keywords : [];
      const url = "/api/works?kw=" + encodeURIComponent(kws.join(","));
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) { setWorks([]); return; }
      const json = await res.json();
      if (Array.isArray(json?.works)) setWorks(json.works as Work[]); else setWorks([]);
    } catch { setWorks([]); }
  }

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
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_360px] gap-3 md:gap-4 p-3 md:p-4 overflow-hidden">
        <aside className="rounded border border-gray-200/60 p-3 md:p-3 overflow-auto">
          <LeftPanel
            works={works}
            selectedWorkId={selectedWorkId}
            onSelect={setSelectedWorkId}
          />
        </aside>

        <main className="rounded border border-gray-200/60 p-2 md:p-3 overflow-auto">
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
        </main>

        <aside className="rounded border border-gray-200/60 p-2 md:p-3 overflow-auto">
          <RightChat
            nodes={nodes}
            edges={edges}
            user={user || undefined}
            onRequireLogin={() => setAuthOpen(true)}
            onSearchReferences={searchReferences}
            onProposePatch={(p) => applyPatch(p)}
          />
        </aside>
      </div>
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
