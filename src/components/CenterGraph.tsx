"use client";

import { useMemo, useState } from "react";
import type { GraphNode, GraphEdge, NodeType, EdgeType } from "@/types/graph";
import * as dagre from "dagre";

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onInvestNode?: (id: string, delta: number) => void;
  onInvestEdge?: (id: string, delta: number) => void;
};

function GraphCanvas({
  nodes,
  edges,
  onHoverNode,
  onHoverEdge,
  onClickNode,
  onClickEdge,
  hoverNodeId,
  hoverEdgeId,
  selectedId,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onHoverNode: (id: string | null) => void;
  onHoverEdge: (id: string | null) => void;
  onClickNode: (id: string) => void;
  onClickEdge: (id: string) => void;
  hoverNodeId: string | null;
  hoverEdgeId: string | null;
  selectedId: string | null;
}) {
  const nodeW = 200;
  const nodeH = 56;
  const g = useMemo(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 80 });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) graph.setNode(n.id, { width: nodeW, height: nodeH });
    for (const e of edges) graph.setEdge(e.sourceId, e.targetId, { id: e.id });
    dagre.layout(graph);
    return graph;
  }, [nodes, edges]);

  const G = g.graph();
  const W = Math.max(960, (G?.width as number) || 960);
  const H = Math.max(480, (G?.height as number) || 480);
  const pos = new Map<string, { x: number; y: number; n: GraphNode }>();
  for (const n of nodes) {
    const p = g.node(n.id) as { x: number; y: number } | undefined;
    if (p) pos.set(n.id, { x: p.x, y: p.y, n });
  }

  const colorFor = (t: EdgeType) => {
    if (t === "supports") return "#16a34a";
    if (t === "refutes") return "#dc2626";
    if (t === "cites") return "#7c3aed";
    if (t === "relates_to") return "#6b7280";
    return "#2563eb";
  };

  const markerId = (t: EdgeType) => `arrow-${t}`;
  const isNodeDim = (id: string) => {
    if (!hoverNodeId && !hoverEdgeId) return false;
    if (hoverNodeId) {
      if (id === hoverNodeId) return false;
      const adj = edges.some((e) => (e.sourceId === hoverNodeId && e.targetId === id) || (e.targetId === hoverNodeId && e.sourceId === id));
      return !adj;
    }
    if (hoverEdgeId) {
      const e = edges.find((x) => x.id === hoverEdgeId);
      if (!e) return false;
      return !(e.sourceId === id || e.targetId === id);
    }
    return false;
  };
  const isEdgeDim = (id: string) => {
    if (!hoverNodeId && !hoverEdgeId) return false;
    if (hoverEdgeId) return hoverEdgeId !== id;
    if (hoverNodeId) {
      const e = edges.find((x) => x.id === id);
      if (!e) return false;
      return !(e.sourceId === hoverNodeId || e.targetId === hoverNodeId);
    }
    return false;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[520px]">
      <defs>
        {(["supports", "refutes", "relates_to", "cites", "infers"] as EdgeType[]).map((t) => (
          <marker key={t} id={markerId(t)} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={colorFor(t)} />
          </marker>
        ))}
      </defs>
      {edges
        .filter((e) => pos.has(e.sourceId) && pos.has(e.targetId))
        .map((e) => {
          const s = pos.get(e.sourceId)!;
          const t = pos.get(e.targetId)!;
          const stroke = colorFor(e.type);
          const midx = (s.x + t.x) / 2;
          const midy = (s.y + t.y) / 2;
          const dim = isEdgeDim(e.id);
          const isSel = selectedId === e.id;
          return (
            <g key={e.id}
               onMouseEnter={() => onHoverEdge(e.id)}
               onMouseLeave={() => onHoverEdge(null)}
               onClick={() => onClickEdge(e.id)}
               style={{ cursor: "pointer" }}
               opacity={dim ? 0.25 : 1}>
              <line x1={s.x + nodeW / 2} y1={s.y} x2={t.x - nodeW / 2} y2={t.y} stroke={stroke} strokeWidth={isSel ? 2.4 : 1.6} markerEnd={`url(#${markerId(e.type)})`} />
              <text x={midx} y={midy - 4} fontSize={10} textAnchor="middle" fill={stroke}>{e.type}</text>
            </g>
          );
        })}
      {Array.from(pos.entries()).map(([id, p]) => {
        const dim = isNodeDim(id);
        const isSel = selectedId === id;
        return (
          <g key={id}
             onMouseEnter={() => onHoverNode(id)}
             onMouseLeave={() => onHoverNode(null)}
             onClick={() => onClickNode(id)}
             style={{ cursor: "pointer" }}
             opacity={dim ? 0.3 : 1}>
            <rect x={p.x - nodeW / 2} y={p.y - nodeH / 2} width={nodeW} height={nodeH} rx={6} ry={6} fill="#fff" stroke={isSel ? "#2563eb" : "#111827"} strokeWidth={isSel ? 2 : 1.2} />
            <text x={p.x - nodeW / 2 + 8} y={p.y - 6} fontSize={12} className="fill-gray-900">{p.n.title}</text>
            <text x={p.x - nodeW / 2 + 8} y={p.y + 12} fontSize={10} className="fill-gray-600 uppercase">{p.n.type}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function CenterGraph({ nodes, edges, onInvestNode, onInvestEdge }: Props) {
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Knowledge Graph</h2>
        <div className="text-xs text-gray-500">{nodes.length} nodes · {edges.length} edges</div>
      </header>

      <section className="rounded border border-gray-200/60 p-3">
        <h3 className="text-sm font-medium mb-2">Graph</h3>
        <GraphCanvas
          nodes={nodes}
          edges={edges}
          onHoverNode={setHoverNodeId}
          onHoverEdge={setHoverEdgeId}
          onClickNode={(id) => setSelectedId(id)}
          onClickEdge={(id) => setSelectedId(id)}
          hoverNodeId={hoverNodeId}
          hoverEdgeId={hoverEdgeId}
          selectedId={selectedId}
        />
        {selectedId && (
          <div className="mt-2 text-xs rounded border border-gray-200/60 p-2 bg-white/50 dark:bg-gray-900/40">
            {(() => {
              const n = nodes.find((x) => x.id === selectedId);
              if (n) return (
                <div>
                  <div className="font-semibold">Node: {n.title}</div>
                  <div className="text-[11px] mt-1">type: {n.type}</div>
                  {n.content && <div className="mt-1">{n.content}</div>}
                </div>
              );
              const e = edges.find((x) => x.id === selectedId);
              if (e) return (
                <div>
                  <div className="font-semibold">Edge: {e.sourceId} → {e.targetId}</div>
                  <div className="text-[11px] mt-1">type: {e.type}</div>
                  <div className="text-[11px]">score: {e.score ?? 0}</div>
                </div>
              );
              return null;
            })()}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded border border-gray-200/60 p-3">
          <h3 className="text-sm font-medium mb-2">Nodes</h3>
          <ul className="space-y-2">
            {nodes.map((n) => (
              <li key={n.id} className="rounded border border-gray-200/50 p-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{n.title}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 uppercase tracking-wide">{n.type}</span>
                </div>
                {n.content && (
                  <p className="text-xs text-gray-600 mt-1 line-clamp-2">{n.content}</p>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[11px] text-gray-600">score: {n.score ?? 0}</div>
                  <div className="flex gap-1">
                    <button
                      className="text-[10px] px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100"
                      onClick={() => onInvestNode?.(n.id, +1)}
                    >+1</button>
                    <button
                      className="text-[10px] px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100"
                      onClick={() => onInvestNode?.(n.id, -1)}
                    >-1</button>
                  </div>
                </div>
              </li>
            ))}
            {nodes.length === 0 && (
              <li className="text-xs text-gray-500">No nodes yet.</li>
            )}
          </ul>
        </div>

        <div className="rounded border border-gray-200/60 p-3">
          <h3 className="text-sm font-medium mb-2">Edges</h3>
          <ul className="space-y-2">
            {edges.map((e) => (
              <li key={e.id} className="rounded border border-gray-200/50 p-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{e.sourceId} → {e.targetId}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 uppercase tracking-wide">{e.type}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[11px] text-gray-600">score: {e.score ?? 0}</div>
                  <div className="flex gap-1">
                    <button
                      className="text-[10px] px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100"
                      onClick={() => onInvestEdge?.(e.id, +1)}
                    >+1</button>
                    <button
                      className="text-[10px] px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100"
                      onClick={() => onInvestEdge?.(e.id, -1)}
                    >-1</button>
                  </div>
                </div>
              </li>
            ))}
            {edges.length === 0 && (
              <li className="text-xs text-gray-500">No edges yet.</li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
