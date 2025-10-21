"use client";

import type { GraphNode, GraphEdge, NodeType } from "@/types/graph";

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onInvestNode?: (id: string, delta: number) => void;
  onInvestEdge?: (id: string, delta: number) => void;
};

function GraphCanvas({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const allTypes: NodeType[] = [
    "premise",
    "inference",
    "conclusion",
    "claim",
    "concept",
    "evidence",
    "source",
    "qa",
  ];
  const colTypes = allTypes.filter((t) => nodes.some((n) => n.type === t));
  const byType: Record<string, GraphNode[]> = {};
  for (const t of colTypes) byType[t] = nodes.filter((n) => n.type === t);
  const maxRows = colTypes.reduce((m, t) => Math.max(m, byType[t].length || 0), 1);
  const W = 960;
  const padding = 32;
  const span = W - padding * 2;
  const colX = (col: number) => padding + (span * col) / Math.max(1, colTypes.length - 1);
  const rowH = 74;
  const H = padding + maxRows * rowH + padding;
  const nodeW = 180;
  const nodeH = 44;
  const pos = new Map<string, { x: number; y: number; t: NodeType; title: string; type: NodeType }>();
  colTypes.forEach((t, ci) => {
    const arr = byType[t] || [];
    arr.forEach((n, ri) => {
      const x = colX(ci);
      const y = padding + rowH * (ri + 0.5);
      pos.set(n.id, { x, y, t, title: n.title, type: n.type });
    });
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-96">
      <defs>
        <marker id="arrow-center" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
        </marker>
      </defs>
      {edges
        .filter((e) => pos.has(e.sourceId) && pos.has(e.targetId))
        .map((e) => {
          const s = pos.get(e.sourceId)!;
          const t = pos.get(e.targetId)!;
          return (
            <line
              key={e.id}
              x1={s.x + nodeW / 2}
              y1={s.y}
              x2={t.x - nodeW / 2}
              y2={t.y}
              stroke="#2563eb"
              strokeWidth={1.6}
              markerEnd="url(#arrow-center)"
              opacity={0.9}
            />
          );
        })}
      {Array.from(pos.entries()).map(([id, p]) => (
        <g key={id}>
          <rect x={p.x - nodeW / 2} y={p.y - nodeH / 2} width={nodeW} height={nodeH} rx={6} ry={6} fill="#fff" stroke="#111827" strokeWidth={1.2} />
          <text x={p.x - nodeW / 2 + 8} y={p.y - 4} fontSize={12} className="fill-gray-900">{p.title}</text>
          <text x={p.x - nodeW / 2 + 8} y={p.y + 14} fontSize={10} className="fill-gray-600 uppercase">{p.type}</text>
        </g>
      ))}
    </svg>
  );
}

export default function CenterGraph({ nodes, edges, onInvestNode, onInvestEdge }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Knowledge Graph</h2>
        <div className="text-xs text-gray-500">{nodes.length} nodes · {edges.length} edges</div>
      </header>

      <section className="rounded border border-gray-200/60 p-3">
        <h3 className="text-sm font-medium mb-2">Graph</h3>
        <GraphCanvas nodes={nodes} edges={edges} />
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
