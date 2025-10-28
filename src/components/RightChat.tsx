"use client";

import { useState } from "react";
import type { LlmPatch, GraphNode, GraphEdge, NodeType, EdgeType } from "@/types/graph";

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onProposePatch: (patch: LlmPatch) => void;
  user?: { email: string; name?: string };
  onRequireLogin?: () => void;
  onSearchReferences?: (query: string) => void;
};

const NODE_TYPES: NodeType[] = [
  "concept",
  "claim",
  "evidence",
  "source",
  "qa",
  "premise",
  "inference",
  "conclusion",
];

export default function RightChat({ nodes, edges, onProposePatch, user, onRequireLogin, onSearchReferences }: Props) {
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<NodeType>("concept");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingAsk, setLoadingAsk] = useState(false);
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [generatingPatch, setGeneratingPatch] = useState(false);
  const [proposedPatch, setProposedPatch] = useState<LlmPatch | null>(null);
  const [loadingConcept, setLoadingConcept] = useState(false);
  const [autoApply, setAutoApply] = useState(true);

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
      setProposedPatch(patch);
      if (autoApply) {
        if (!user) {
          onRequireLogin?.();
        } else {
          onProposePatch(patch);
          setProposedPatch(null);
        }
      }
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
      const question = prompt.trim();
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question, history }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Chat failed");
      }
      const data = (await res.json()) as { answer?: string };
      const answer = data.answer ?? "";
      if (answer) {
        setHistory((h) => [...h, { role: "user", content: question }, { role: "assistant", content: answer }]);
        setPrompt("");
        // auto conceptualize: generate a patch from the answer and show preview
        try {
          setGeneratingPatch(true);
          const pres = await fetch("/api/ai/patch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "from_answer", answer, prompt: question, nodes, edges }),
          });
          if (pres.ok) {
            const p = (await pres.json()) as LlmPatch;
            setProposedPatch(p);
            if (autoApply) {
              if (!user) {
                onRequireLogin?.();
              } else {
                onProposePatch(p);
                setProposedPatch(null);
              }
            }
          }
          // refresh left references by question term
          onSearchReferences?.(question);
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

  async function conceptualize() {
    if (!prompt.trim()) {
      setError("Paste text to conceptualize.");
      return;
    }
    try {
      setLoadingConcept(true);
      setError(null);
      setProposedPatch(null);
      setGeneratingPatch(true);
      const pres = await fetch("/api/ai/patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "from_answer", answer: prompt.trim(), prompt: prompt.trim(), title: title.trim() || undefined, nodes, edges }),
      });
      if (!pres.ok) {
        const err = await pres.json().catch(() => ({}));
        throw new Error(err?.error || "Conceptualize failed");
      }
      const p = (await pres.json()) as LlmPatch;
      setProposedPatch(p);
      if (autoApply) {
        if (!user) {
          onRequireLogin?.();
        } else {
          onProposePatch(p);
          setProposedPatch(null);
        }
      }
      onSearchReferences?.(prompt.trim());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGeneratingPatch(false);
      setLoadingConcept(false);
    }
  }

  function acceptProposed() {
    if (!proposedPatch) return;
    if (!user) {
      onRequireLogin?.();
      return;
    }
    onProposePatch(proposedPatch);
    setProposedPatch(null);
  }

  function discardProposed() {
    setProposedPatch(null);
  }

  function PatchPreviewGraph({ patch }: { patch: LlmPatch }) {
    const addedNodes: GraphNode[] = [];
    const addedEdges: GraphEdge[] = [];
    for (const op of patch.ops) {
      if (op.op === "add_node") addedNodes.push(op.node);
      else if (op.op === "add_edge") addedEdges.push(op.edge);
    }

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
    const present = new Set<NodeType>(addedNodes.map((n) => n.type));
    const cols: NodeType[] = allTypes.filter((t) => present.has(t));
    const colX = (col: number, W: number) => {
      const padding = 24;
      const span = W - padding * 2;
      return padding + (span * col) / (cols.length - 1);
    };

    const byType = new Map<NodeType, GraphNode[]>();
    cols.forEach((t) => byType.set(t, addedNodes.filter((n) => n.type === t)));

    const maxRows = Math.max(1, ...cols.map((t) => (byType.get(t)?.length ?? 0)));
    const W = 360;
    const rowH = 44;
    const H = 24 + maxRows * rowH + 24;

    const pos = new Map<string, { x: number; y: number; t: NodeType; title: string }>();
    cols.forEach((t, ci) => {
      const arr = byType.get(t) ?? [];
      arr.forEach((n, idx) => {
        const y = 24 + rowH * (idx + 0.5);
        pos.set(n.id, { x: colX(ci, W), y, t, title: n.title });
      });
    });

    const colorFor = (t: EdgeType) => {
      if (t === "supports") return "#16a34a";
      if (t === "refutes") return "#dc2626";
      if (t === "cites") return "#7c3aed";
      if (t === "relates_to") return "#6b7280";
      return "#2563eb";
    };

    const radius = 8;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32 md:h-40">
        <defs>
          {(["supports","refutes","relates_to","cites","infers"] as EdgeType[]).map((t) => (
            <marker key={t} id={`arrow-mini-${t}`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={colorFor(t)} />
            </marker>
          ))}
        </defs>
        {addedEdges
          .filter((e) => pos.has(e.sourceId) && pos.has(e.targetId))
          .map((e) => {
            const s = pos.get(e.sourceId)!;
            const t = pos.get(e.targetId)!;
            const stroke = colorFor(e.type);
            const midx = (s.x + t.x) / 2;
            const midy = (s.y + t.y) / 2;
            return (
              <g key={e.id}>
                <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={stroke} strokeWidth={1.2} markerEnd={`url(#arrow-mini-${e.type})`} opacity={0.9} />
                <text x={midx} y={midy - 3} fontSize={9} textAnchor="middle" fill={stroke}>{e.type}</text>
              </g>
            );
          })}
        {[...pos.entries()].map(([id, p]) => (
          <g key={id}>
            <circle cx={p.x} cy={p.y} r={radius} fill="#fff" stroke="#111827" strokeWidth={1.5} />
            <text x={p.x + 12} y={p.y + 4} fontSize={10} className="fill-gray-800">
              {p.title}
            </text>
          </g>
        ))}
      </svg>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">AI Q&A</h2>
      <div className="flex flex-col gap-2 max-h-48 md:max-h-64 overflow-auto rounded border border-gray-200/60 p-2 bg-white/40 dark:bg-gray-900/40">
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
              <button onClick={acceptProposed} className="text-xs px-2 py-1 rounded bg-blue-600 text-white">{user ? "Apply" : "Sign in to Apply"}</button>
            </div>
          </div>
          {proposedPatch.description && (
            <div className="mt-2 text-xs whitespace-pre-wrap text-gray-800 dark:text-gray-100">{proposedPatch.description}</div>
          )}
          <div className="mt-2">
            <PatchPreviewGraph patch={proposedPatch} />
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(["premise","inference","conclusion"] as NodeType[]).map((t) => {
              const added = proposedPatch.ops.reduce<GraphNode[]>((acc, op) => {
                if (op.op === "add_node" && op.node.type === t) acc.push(op.node);
                return acc;
              }, []);
              if (added.length === 0) return <div key={t} />;
              return (
                <div key={t} className="rounded border border-gray-200/60 bg-white/60 dark:bg-gray-900/40 p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">{t}</div>
                  <ul className="mt-1 space-y-1">
                    {added.map((n) => (
                      <li key={n.id} className="text-xs">{n.title}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <details className="mt-2">
            <summary className="text-xs font-medium cursor-pointer">Operations</summary>
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
          </details>
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
          <button
            onClick={conceptualize}
            className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            disabled={loadingConcept || prompt.trim().length === 0}
          >
            {loadingConcept ? "Conceptualizing..." : "Conceptualize"}
          </button>
          <label className="ml-auto flex items-center gap-1 text-xs text-gray-700">
            <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
            Auto-apply
          </label>
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
