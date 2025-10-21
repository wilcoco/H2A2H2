export type NodeType =
  | "concept"
  | "claim"
  | "evidence"
  | "source"
  | "qa"
  | "premise"
  | "inference"
  | "conclusion";

export interface GraphNode {
  id: string;
  type: NodeType;
  title: string;
  content?: string;
  score?: number;
}

export type EdgeType = "supports" | "refutes" | "relates_to" | "cites" | "infers";

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  score?: number;
}

export interface Work {
  id: string;
  title: string;
  description?: string;
  investmentScore: number;
  nodeCount: number;
}

export type PatchOp =
  | { op: "add_node"; node: GraphNode }
  | { op: "update_node"; id: string; patch: Partial<GraphNode> }
  | { op: "remove_node"; id: string }
  | { op: "add_edge"; edge: GraphEdge }
  | { op: "remove_edge"; id: string };

export interface LlmPatch {
  id: string;
  description?: string;
  ops: PatchOp[];
}
