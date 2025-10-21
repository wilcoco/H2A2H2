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
  const [loadingAsk, setLoadingAsk] = useState(false);
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [generatingPatch, setGeneratingPatch] = useState(false);
  const [proposedPatch, setProposedPatch] = useState<LlmPatch | null>(null);

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

  async function ask() {
    if (!prompt.trim()) {
      setError("Enter a prompt to ask.");
      return;
    }
    try {
      setLoadingAsk(true);
      setError(null);
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), history }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Chat failed");
      }
      const data = (await res.json()) as { answer?: string };
      const answer = data.answer ?? "";
      if (answer) {
        setHistory((h) => [...h, { role: "user", content: prompt.trim() }, { role: "assistant", content: answer }]);
        setPrompt("");
        // auto conceptualize: generate a patch from the answer and show preview
        try {
          setGeneratingPatch(true);
          const pres = await fetch("/api/ai/patch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "from_answer", answer, nodes, edges }),
          });
          if (pres.ok) {
            const p = (await pres.json()) as LlmPatch;
            setProposedPatch(p);
          }
        } finally {
          setGeneratingPatch(false);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoadingAsk(false);
    }
  }

  function acceptProposed() {
    if (proposedPatch) {
      onProposePatch(proposedPatch);
      setProposedPatch(null);
    }
  }

  function discardProposed() {
    setProposedPatch(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">AI Q&A</h2>
      <div className="flex flex-col gap-2 max-h-64 overflow-auto rounded border border-gray-200/60 p-2 bg-white/40 dark:bg-gray-900/40">
        {history.length === 0 && (
          <div className="text-xs text-gray-500">질문을 입력하고 Ask를 누르면 응답이 여기에 표시됩니다.</div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`text-sm ${m.role === "assistant" ? "text-gray-900" : "text-gray-700"}`}>
            <span className="font-medium mr-1">{m.role === "assistant" ? "AI" : "You"}:</span>
            <span>{m.content}</span>
          </div>
        ))}
      </div>
      {generatingPatch && (
        <div className="text-xs text-gray-500">답변을 지식 그래프로 구조화하는 중...</div>
      )}
      {proposedPatch && (
        <div className="rounded border border-blue-200 p-2 bg-blue-50 dark:bg-blue-950/20">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Proposed changes</h3>
            <div className="flex gap-2">
              <button onClick={discardProposed} className="text-xs px-2 py-1 rounded border border-gray-300">Discard</button>
              <button onClick={acceptProposed} className="text-xs px-2 py-1 rounded bg-blue-600 text-white">Apply</button>
            </div>
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {proposedPatch.ops.map((op, idx) => (
              <li key={idx} className="font-mono">
                {op.op === "add_node" && `add_node: ${op.node.id} [${op.node.type}] ${op.node.title}`}
                {op.op === "update_node" && `update_node: ${op.id}`}
                {op.op === "remove_node" && `remove_node: ${op.id}`}
                {op.op === "add_edge" && `add_edge: ${op.edge.id} ${op.edge.sourceId}->${op.edge.targetId} [${op.edge.type}]`}
                {op.op === "remove_edge" && `remove_edge: ${op.id}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <textarea
          className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
          rows={4}
          placeholder="Ask or paste AI suggestion context..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={ask}
            className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            disabled={loadingAsk || prompt.trim().length === 0}
          >
            {loadingAsk ? "Asking..." : "Ask"}
          </button>
        </div>
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
