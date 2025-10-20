"use client";

import type { GraphNode, GraphEdge } from "@/types/graph";

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export default function CenterGraph({ nodes, edges }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Knowledge Graph</h2>
        <div className="text-xs text-gray-500">{nodes.length} nodes · {edges.length} edges</div>
      </header>

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
