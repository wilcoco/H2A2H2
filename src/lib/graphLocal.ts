// Bidirectional BFS to compute the N-hop neighborhood around a focus node.
// Works on any { sourceId, targetId } edge shape and any node with `id`.

export interface MinNode { id: string }
export interface MinEdge { sourceId: string; targetId: string }

export interface Neighborhood<N extends MinNode, E extends MinEdge> {
  nodes: N[];
  edges: E[];
  distances: Map<string, number>;
}

export function bfsNeighborhood<N extends MinNode, E extends MinEdge>(
  nodes: N[],
  edges: E[],
  focusId: string | null | undefined,
  hops: number,
): Neighborhood<N, E> {
  // Sentinel: no focus or hops not finite → pass everything through unchanged.
  if (!focusId || !Number.isFinite(hops) || hops < 0) {
    return { nodes, edges, distances: new Map() };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(focusId)) {
    // Focus not in this graph — return full set so UI doesn't go empty.
    return { nodes, edges, distances: new Map() };
  }

  // Build adjacency (undirected for neighborhood discovery).
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!nodeIds.has(e.sourceId) || !nodeIds.has(e.targetId)) continue;
    if (!adj.has(e.sourceId)) adj.set(e.sourceId, new Set());
    if (!adj.has(e.targetId)) adj.set(e.targetId, new Set());
    adj.get(e.sourceId)!.add(e.targetId);
    adj.get(e.targetId)!.add(e.sourceId);
  }

  const distances = new Map<string, number>();
  distances.set(focusId, 0);
  const queue: string[] = [focusId];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = distances.get(cur)!;
    if (d >= hops) continue;
    const nbrs = adj.get(cur);
    if (!nbrs) continue;
    for (const nb of nbrs) {
      if (distances.has(nb)) continue;
      distances.set(nb, d + 1);
      queue.push(nb);
    }
  }

  const included = new Set(distances.keys());
  const filteredNodes = nodes.filter((n) => included.has(n.id));
  const filteredEdges = edges.filter((e) => included.has(e.sourceId) && included.has(e.targetId));
  return { nodes: filteredNodes, edges: filteredEdges, distances };
}
