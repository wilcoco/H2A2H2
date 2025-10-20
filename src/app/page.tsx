"use client";

import { useState } from "react";
import LeftPanel from "@/components/LeftPanel";
import CenterGraph from "@/components/CenterGraph";
import RightChat from "@/components/RightChat";
import type { GraphNode, GraphEdge, Work, LlmPatch } from "@/types/graph";

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

  function applyPatch(patch: LlmPatch) {
    let nextNodes = [...nodes];
    let nextEdges = [...edges];
    for (const op of patch.ops) {
      if (op.op === "add_node") {
        if (!nextNodes.some((n) => n.id === op.node.id)) nextNodes.push(op.node);
      } else if (op.op === "update_node") {
        nextNodes = nextNodes.map((n) => (n.id === op.id ? { ...n, ...op.patch } : n));
      } else if (op.op === "remove_node") {
        nextNodes = nextNodes.filter((n) => n.id !== op.id);
        nextEdges = nextEdges.filter((e) => e.sourceId !== op.id && e.targetId !== op.id);
      } else if (op.op === "add_edge") {
        const srcOk = nextNodes.some((n) => n.id === op.edge.sourceId);
        const dstOk = nextNodes.some((n) => n.id === op.edge.targetId);
        const dup = nextEdges.some((e) => e.id === op.edge.id);
        if (srcOk && dstOk && !dup) nextEdges.push(op.edge);
      } else if (op.op === "remove_edge") {
        nextEdges = nextEdges.filter((e) => e.id !== op.id);
      }
    }
    setNodes(nextNodes);
    setEdges(nextEdges);
  }

  return (
    <div className="min-h-screen h-screen grid grid-rows-[auto_1fr]">
      <header className="border-b border-gray-200/60 p-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">Knowledge Builder</h1>
        <div className="text-xs text-gray-500">MVP · 3-panels</div>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr_360px] gap-4 p-4 overflow-hidden">
        <aside className="rounded border border-gray-200/60 p-3 overflow-auto">
          <LeftPanel
            works={works}
            selectedWorkId={selectedWorkId}
            onSelect={setSelectedWorkId}
          />
        </aside>

        <main className="rounded border border-gray-200/60 p-3 overflow-auto">
          <CenterGraph nodes={nodes} edges={edges} />
        </main>

        <aside className="rounded border border-gray-200/60 p-3 overflow-auto">
          <RightChat
            nodes={nodes}
            edges={edges}
            onProposePatch={(p) => applyPatch(p)}
          />
        </aside>
      </div>
    </div>
  );
}
