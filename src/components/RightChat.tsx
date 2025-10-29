"use client";

import { useState } from "react";
import type { LlmPatch, GraphNode, GraphEdge, NodeType, EdgeType, Work, QAEntry } from "@/types/graph";

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
  const [reuseLoading, setReuseLoading] = useState(false);
  const [reuseFound, setReuseFound] = useState<Work[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [qaFound, setQaFound] = useState<QAEntry[]>([]);
  const [qaDetail, setQaDetail] = useState<Record<string, { patch?: LlmPatch }>>({});
  const [lastAnswer, setLastAnswer] = useState<string>("");
  const [extendId, setExtendId] = useState<string | null>(null);
  const [extendText, setExtendText] = useState<string>("");
  const [extendLoading, setExtendLoading] = useState(false);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [threadTree, setThreadTree] = useState<any | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [followupText, setFollowupText] = useState<Record<string, string>>({});
  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const [voteBusy, setVoteBusy] = useState<Record<string, boolean>>({});

  async function useQA(id: string) {
    try {
      const res = await fetch(`/api/qa/${encodeURIComponent(id)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to load QA");
      }
      const q = (await res.json()) as { id?: string; rootId?: string; question: string; answer?: string; patch?: LlmPatch };
      if (q.patch) {
        setProposedPatch(q.patch);
        if (autoApply) {
          if (!user) onRequireLogin?.(); else { onProposePatch(q.patch); setProposedPatch(null); }
        }
      } else if (q.answer) {
        // Fall back: conceptualize the stored answer
        await askLlmInternal(q.answer);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setQaFound([]);
      setPendingQuestion(null);
    }
  }

  async function loadThread(rootId: string) {
    try {
      setThreadLoading(true);
      const res = await fetch(`/api/qa/thread?rootId=${encodeURIComponent(rootId)}&depth=3`, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to load thread");
      }
      const j = await res.json();
      setThreadTree(j.root);
      setThreadRootId(rootId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setThreadLoading(false);
    }
  }

  async function openFollowupsFor(id: string) {
    try {
      const res = await fetch(`/api/qa/${encodeURIComponent(id)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to load QA detail");
      }
      const q = await res.json();
      const rid: string = q?.rootId || q?.id || id;
      await loadThread(rid);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function addFollowup(parentId: string) {
    try {
      const text = (followupText[parentId] || "").trim();
      if (!text) return;
      const res = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, parentId }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to share follow-up");
      }
      setFollowupText((m) => ({ ...m, [parentId]: "" }));
      if (threadRootId) await loadThread(threadRootId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function aiAnswer(qaId: string, question: string) {
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: question, history: [] }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Chat failed");
      }
      const data = await res.json();
      const answer = String(data?.answer || "");
      if (!answer) return;
      const u = await fetch("/api/qa/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, answer }) });
      if (!u.ok) {
        const err = await u.json().catch(() => ({}));
        throw new Error(err?.error || "Save failed");
      }
      if (threadRootId) await loadThread(threadRootId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function submitNote(qaId: string) {
    try {
      const content = (noteText[qaId] || "").trim();
      if (!content) return;
      const res = await fetch("/api/qa/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, content }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to save note");
      }
      setNoteText((m) => ({ ...m, [qaId]: "" }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function sendVote(qaId: string, vote: 1 | -1, comment?: string) {
    try {
      setVoteBusy((m) => ({ ...m, [qaId]: true }));
      const res = await fetch("/api/qa/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, vote, comment }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to vote");
      }
      if (threadRootId) await loadThread(threadRootId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setVoteBusy((m) => ({ ...m, [qaId]: false }));
    }
  }

  async function shareQA() {
    try {
      const question = pendingQuestion || history.filter(h => h.role === "user").slice(-1)[0]?.content || prompt.trim();
      const payload: any = { question };
      if (lastAnswer) payload.answer = lastAnswer;
      if (proposedPatch) payload.patch = proposedPatch;
      const res = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to share");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function submitExtend(entry: QAEntry) {
    try {
      if (!extendText.trim()) return;
      setExtendLoading(true);
      const res = await fetch("/api/qa/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: entry.question, summary: extendText.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to share");
      }
      setExtendId(null);
      setExtendText("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setExtendLoading(false);
    }
  }

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
    const question = prompt.trim();
    // 1) Reuse pre-check
    try {
      setReuseLoading(true);
      setPendingQuestion(question);
      setError(null);
      // trigger left references too
      onSearchReferences?.(question);
      const kres = await fetch("/api/ai/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: question, max: 6 }),
      });
      const kj = await kres.json().catch(() => ({ keywords: [] }));
      const kws: string[] = Array.isArray(kj?.keywords) ? kj.keywords : [];
      const url = "/api/works?kw=" + encodeURIComponent(kws.join(","));
      const wres = await fetch(url, { cache: "no-store" });
      const wj = await wres.json().catch(() => ({ works: [] }));
      const works: Work[] = Array.isArray(wj?.works) ? (wj.works as Work[]) : [];
      setReuseFound(works.slice(0, 3));
      // Also query QA index
      const qares = await fetch("/api/qa/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, limit: 5 }) });
      const qaj = await qares.json().catch(() => ({ items: [] }));
      const items: QAEntry[] = Array.isArray(qaj?.items) ? (qaj.items as QAEntry[]) : [];
      setQaFound(items);
      // Prefetch details for patch preview
      const detail: Record<string, { patch?: LlmPatch }> = {};
      await Promise.all(items.map(async (it) => {
        try {
          const r = await fetch(`/api/qa/${encodeURIComponent(it.id)}`);
          if (r.ok) {
            const dj = await r.json();
            if (dj?.patch) detail[it.id] = { patch: dj.patch as LlmPatch };
          }
        } catch {}
      }));
      setQaDetail(detail);
      if (works.length > 0 || items.length > 0) {
        setReuseLoading(false);
        return; // show curated options first
      }
    } catch {
      // ignore reuse errors and fall back to LLM
    } finally {
      setReuseLoading(false);
    }
    // 2) No reuse found → call LLM
    await askLlmInternal(question);
  }

  async function askLlmInternal(question: string) {
    try {
      setLoadingAsk(true);
      setError(null);
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
        setLastAnswer(answer);
        setPrompt("");
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

  function buildPatchFromGraph(title: string, g: { nodes: GraphNode[]; edges: GraphEdge[] }): LlmPatch {
    const existingNodeIds = new Set(nodes.map((n) => n.id));
    const existingEdgeIds = new Set(edges.map((e) => e.id));
    const addNodes: GraphNode[] = g.nodes.filter((n) => !existingNodeIds.has(n.id));
    const nextNodeIds = new Set<string>([...existingNodeIds, ...addNodes.map((n) => n.id)]);
    const addEdges: GraphEdge[] = g.edges.filter((e) => !existingEdgeIds.has(e.id) && nextNodeIds.has(e.sourceId) && nextNodeIds.has(e.targetId));
    const ops: LlmPatch["ops"] = [];
    for (const n of addNodes) ops.push({ op: "add_node", node: n });
    for (const e of addEdges) ops.push({ op: "add_edge", edge: e });
    return {
      id: `reuse_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      description: `Reuse: imported ${addNodes.length} nodes and ${addEdges.length} edges from "${title}"`,
      ops,
    };
  }

  async function useWork(id: string, title: string) {
    try {
      setError(null);
      const res = await fetch(`/api/works/${encodeURIComponent(id)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to load work");
      }
      const data = (await res.json()) as { graph: { nodes: GraphNode[]; edges: GraphEdge[] } };
      const patch = buildPatchFromGraph(title, data.graph);
      setProposedPatch(patch);
      if (autoApply) {
        if (!user) {
          onRequireLogin?.();
        } else {
          onProposePatch(patch);
          setProposedPatch(null);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setReuseFound([]);
      setPendingQuestion(null);
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

  function renderThread(node: any, depth: number) {
    const qaId = node.id as string;
    const follow = followupText[qaId] || "";
    const note = noteText[qaId] || "";
    return (
      <div className="border-l pl-3 ml-1 my-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">Q: {node.question}</div>
            <div className="text-[11px] text-gray-600 mt-0.5">{node.hasAnswer ? "답변 있음" : "미답변"}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button className="text-[11px] px-2 py-1 rounded border" disabled={voteBusy[qaId]} onClick={() => void sendVote(qaId, 1)}>Helpful ({node.helpful || 0})</button>
            <button className="text-[11px] px-2 py-1 rounded border" disabled={voteBusy[qaId]} onClick={() => void sendVote(qaId, -1)}>Not ({node.unhelpful || 0})</button>
            {!node.hasAnswer && (
              <button className="text-[11px] px-2 py-1 rounded border" onClick={() => void aiAnswer(qaId, node.question)}>AI 답변 생성</button>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="flex-1 rounded border border-gray-300 bg-white/90 p-1 text-xs dark:bg-gray-900/60"
            placeholder="후속 질문 추가"
            value={follow}
            onChange={(e) => setFollowupText((m: Record<string, string>) => ({ ...m, [qaId]: e.target.value }))}
          />
          <button className="text-[11px] px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={!follow.trim()} onClick={() => void addFollowup(qaId)}>추가</button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="flex-1 rounded border border-gray-300 bg-white/90 p-1 text-xs dark:bg-gray-900/60"
            placeholder="수정 의견/요약 추가"
            value={note}
            onChange={(e) => setNoteText((m: Record<string, string>) => ({ ...m, [qaId]: e.target.value }))}
          />
          <button className="text-[11px] px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50" disabled={!note.trim()} onClick={() => void submitNote(qaId)}>저장</button>
        </div>
        {Array.isArray(node.children) && node.children.length > 0 && (
          <div className="mt-2">
            {node.children.map((ch: any) => (
              <div key={ch.id}>{renderThread(ch, depth + 1)}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">AI Q&A</h2>
      {reuseLoading && (
        <div className="text-xs text-gray-500">유사한 공개 정리물을 찾는 중...</div>
      )}
      {(reuseFound.length > 0 || qaFound.length > 0) && (
        <div className="rounded border border-emerald-200 p-2 bg-emerald-50 dark:bg-emerald-950/20">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">유사한 정리 결과</h3>
            <div className="flex gap-2">
              <button className="text-xs px-2 py-1 rounded border border-gray-300" onClick={() => { setReuseFound([]); setQaFound([]); setPendingQuestion(null); }}>Dismiss</button>
            </div>
      {threadRootId && (
        <div className="rounded border border-amber-200 p-2 bg-amber-50 dark:bg-amber-950/20">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">후속 질문 마인드맵 (depth 3)</h3>
            <div className="flex gap-2">
              <button className="text-xs px-2 py-1 rounded border" onClick={() => { if (threadRootId) void loadThread(threadRootId); }}>Refresh</button>
              <button className="text-xs px-2 py-1 rounded border" onClick={() => { setThreadRootId(null); setThreadTree(null); }}>Close</button>
            </div>
          </div>
          {threadLoading && <div className="text-xs text-gray-500 mt-2">불러오는 중...</div>}
          {threadTree && (
            <div className="mt-2">
              {renderThread(threadTree, 1)}
            </div>
          )}
        </div>
      )}
          </div>
          <ul className="mt-2 space-y-2">
            {reuseFound.map((w) => (
              <li key={w.id} className="rounded border border-gray-200/60 p-2 bg-white/60 dark:bg-gray-900/40">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{w.title}</div>
                    {w.description && <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{w.description}</div>}
                  </div>
                  <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white" onClick={() => void useWork(w.id, w.title)}>Use</button>
                </div>
                <div className="mt-1 text-[11px] text-gray-500">{w.nodeCount} nodes · score {w.investmentScore}</div>
              </li>
            ))}
            {qaFound.map((q) => (
              <li key={q.id} className="rounded border border-gray-200/60 p-2 bg-white/60 dark:bg-gray-900/40">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Q: {q.question}</div>
                    {q.answer && <div className="text-xs text-gray-800 mt-1 whitespace-pre-wrap">A: {q.answer}</div>}
                    {q.summary && <div className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">Summary: {q.summary}</div>}
                    {qaDetail[q.id]?.patch && (
                      <div className="mt-2">
                        <PatchPreviewGraph patch={qaDetail[q.id]!.patch!} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white" onClick={() => void useQA(q.id)}>Use</button>
                    <button className="text-xs px-2 py-1 rounded border" onClick={() => void openFollowupsFor(q.id)}>Follow-ups</button>
                    <button className="text-xs px-2 py-1 rounded border" onClick={() => { setExtendId(extendId === q.id ? null : q.id); if (extendId !== q.id) setExtendText(""); }}>Extend</button>
                  </div>
                </div>
                {extendId === q.id && (
                  <div className="mt-2">
                    <textarea
                      className="w-full rounded border border-gray-300 bg-white/90 p-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
                      rows={3}
                      placeholder="Add additional summary/notes to share"
                      value={extendText}
                      onChange={(e) => setExtendText(e.target.value)}
                    />
                    <div className="mt-1 flex items-center gap-2">
                      <button className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50" disabled={extendLoading || extendText.trim().length === 0} onClick={() => void submitExtend(q)}>
                        {extendLoading ? "Sharing..." : "Share Update"}
                      </button>
                      <button className="text-xs px-2 py-1 rounded border" onClick={() => { setExtendId(null); setExtendText(""); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
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
          {(reuseFound.length > 0 || qaFound.length > 0) && (
            <button
              onClick={() => { const q = pendingQuestion || prompt.trim(); if (q) void askLlmInternal(q); setReuseFound([]); setQaFound([]); setPendingQuestion(null); }}
              className="rounded border px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
            >
              LLM에 직접 질문
            </button>
          )}
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
          <button
            onClick={shareQA}
            className="rounded border px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50"
            disabled={!lastAnswer && !proposedPatch}
          >
            Share Q&A
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
