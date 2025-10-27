"use client";

import { useEffect, useState } from "react";
import LeftPanel from "@/components/LeftPanel";
import CenterGraph from "@/components/CenterGraph";
import RightChat from "@/components/RightChat";
import type { GraphNode, GraphEdge, Work, LlmPatch } from "@/types/graph";
import AuthModal from "@/components/AuthModal";

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
  const [works] = useState<Work[]>(initialWorks);
  const [selectedWorkId, setSelectedWorkId] = useState<string | undefined>();
  const [user, setUser] = useState<{ email: string; name?: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

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
          <CenterGraph nodes={nodes} edges={edges} onInvestNode={investNode} onInvestEdge={investEdge} />
        </main>

        <aside className="rounded border border-gray-200/60 p-2 md:p-3 overflow-auto">
          <RightChat
            nodes={nodes}
            edges={edges}
            user={user || undefined}
            onRequireLogin={() => setAuthOpen(true)}
            onProposePatch={(p) => applyPatch(p)}
          />
        </aside>
      </div>
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignedIn={(u) => setUser(u)}
      />
    </div>
  );
}
