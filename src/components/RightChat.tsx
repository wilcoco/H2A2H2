"use client";

import { useState } from "react";
import type { LlmPatch, GraphNode, GraphEdge, NodeType } from "@/types/graph";

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onProposePatch: (patch: LlmPatch) => void;
};

const NODE_TYPES: NodeType[] = ["concept", "claim", "evidence", "source", "qa"];

export default function RightChat({ nodes, edges, onProposePatch }: Props) {
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<NodeType>("concept");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proposePatch() {
    if (!prompt.trim() && !title.trim()) {
      setError("Enter a prompt or a title.");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/ai/patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), title: title.trim() || undefined, type, nodes, edges }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Request failed");
      }
      const patch = (await res.json()) as LlmPatch;
      onProposePatch(patch);
      setTitle("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">AI Q&A</h2>
      <div className="flex flex-col gap-2">
        <textarea
          className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
          rows={4}
          placeholder="Ask or paste AI suggestion context..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as NodeType)}
            className="rounded border border-gray-300 bg-white/90 p-2 text-sm dark:bg-gray-900/60"
          >
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
            placeholder="New node title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            onClick={proposePatch}
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={(prompt.trim().length === 0 && title.trim().length === 0) || loading}
          >
            {loading ? "Proposing..." : "Propose"}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      <div className="text-xs text-gray-500">
        {nodes.length} nodes available for linking in future iterations.
      </div>
    </div>
  );
}
