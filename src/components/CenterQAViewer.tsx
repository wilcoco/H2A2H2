"use client";

import { useEffect, useState } from "react";
import type { LlmPatch, NodeType, EdgeType } from "@/types/graph";

type Props = {
  qaId?: string;
  question?: string;
  aiAnswer?: string;
  onOpenThread?: () => void;
  onShared?: (id: string) => void;
  onPinned?: (id: string) => void;
};

export default function CenterQAViewer({ qaId, question, aiAnswer, onOpenThread, onShared, onPinned }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any | null>(null);
  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [newSummary, setNewSummary] = useState("");
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [notes, setNotes] = useState<Array<{ id: string; userId?: string; content: string; createdAt: string }>>([]);

  useEffect(() => {
    let mounted = true;
    async function run() {
      if (!qaId) { setData(null); return; }
      try {
        setLoading(true);
        setError(null);
        const r = await fetch(`/api/qa/${encodeURIComponent(qaId)}`, { cache: "no-store" });
        if (!r.ok) throw new Error("Failed to load QA");
        const j = await r.json();
        if (mounted) setData(j);
      } catch (e: unknown) {
        if (mounted) setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void run();
    return () => { mounted = false; };
  }, [qaId]);

  async function saveNote() {
    const content = note.trim();
    if (!qaId || !content) return;
    try {
      setSavingNote(true);
      const res = await fetch("/api/qa/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, content }) });
      if (!res.ok) throw new Error("Note failed");
      setNote("");
      // refresh notes
      const r = await fetch(`/api/qa/note?qaId=${encodeURIComponent(qaId)}`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        setNotes(Array.isArray(j?.notes) ? j.notes : []);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSavingNote(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      if (!qaId) { if (active) setNotes([]); return; }
      try {
        const r = await fetch(`/api/qa/note?qaId=${encodeURIComponent(qaId)}`, { cache: "no-store" });
        if (!r.ok) throw new Error("Notes failed");
        const j = await r.json();
        if (active) setNotes(Array.isArray(j?.notes) ? j.notes : []);
      } catch {
        if (active) setNotes([]);
      }
    })();
    return () => { active = false; };
  }, [qaId]);

  async function vote(v: 1 | -1) {
    if (!qaId) return;
    try {
      setVoteBusy(true);
      const res = await fetch("/api/qa/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, vote: v }) });
      if (!res.ok) throw new Error("Vote failed");
      // refresh counts
      const r = await fetch(`/api/qa/${encodeURIComponent(qaId)}`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setVoteBusy(false);
    }
  }

  async function saveSummary() {
    if (!qaId) return;
    const s = editSummary.trim();
    if (!s) return;
    try {
      setSaving(true);
      const res = await fetch("/api/qa/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, summary: s }) });
      if (!res.ok) throw new Error("Update failed");
      const r = await fetch(`/api/qa/${encodeURIComponent(qaId)}`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
      setEditing(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function shareNew() {
    const q = (question || "").trim();
    const a = (aiAnswer || "").trim();
    if (!q || !a) return;
    try {
      setSaving(true);
      const res = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, answer: a, summary: newSummary.trim() || undefined }) });
      if (!res.ok) throw new Error("Share failed");
      const j = await res.json();
      const id = String(j?.id || "");
      if (id) {
        onShared?.(id);
        onPinned?.(id);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  function PatchPreviewGraph({ patch }: { patch: LlmPatch }) {
    const addedNodes = patch.ops.filter(op => op.op === "add_node").map(op => (op as any).node);
    const addedEdges = patch.ops.filter(op => op.op === "add_edge").map(op => (op as any).edge);

    const allTypes: NodeType[] = ["premise","inference","conclusion","claim","concept","evidence","source","qa"];
    const present = new Set<NodeType>(addedNodes.map((n: any) => n.type as NodeType));
    const cols: NodeType[] = allTypes.filter((t) => present.has(t));
    const colX = (col: number, W: number) => {
      const padding = 24; const span = W - padding * 2; return padding + (span * col) / Math.max(1, (cols.length - 1));
    };
    const byType = new Map<NodeType, any[]>();
    cols.forEach((t) => byType.set(t, addedNodes.filter((n: any) => n.type === t)));
    const maxRows = Math.max(1, ...cols.map((t) => (byType.get(t)?.length ?? 0)));
    const W = 360; const rowH = 44; const H = 24 + maxRows * rowH + 24;
    const pos = new Map<string, { x: number; y: number; t: NodeType; title: string }>();
    cols.forEach((t, ci) => {
      const arr = byType.get(t) ?? [];
      arr.forEach((n, idx) => { const y = 24 + rowH * (idx + 0.5); pos.set(n.id, { x: colX(ci, W), y, t, title: n.title }); });
    });
    const colorFor = (t: EdgeType) => t === "supports" ? "#16a34a" : t === "refutes" ? "#dc2626" : t === "cites" ? "#7c3aed" : t === "relates_to" ? "#6b7280" : "#2563eb";
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
          .filter((e: any) => pos.has(e.sourceId) && pos.has(e.targetId))
          .map((e: any) => {
            const s = pos.get(e.sourceId)!; const t = pos.get(e.targetId)!; const stroke = colorFor(e.type);
            const midx = (s.x + t.x) / 2; const midy = (s.y + t.y) / 2;
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
            <text x={p.x + 12} y={p.y + 4} fontSize={10} className="fill-gray-800">{p.title}</text>
          </g>
        ))}
      </svg>
    );
  }

  if (loading) return <div className="text-xs text-gray-500">불러오는 중...</div>;
  if (error) return <div className="text-xs text-red-600">{error}</div>;

  if (qaId && data) {
    const patch: LlmPatch | undefined = data?.patch;
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Q: {data.question}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="text-xs px-2 py-1 rounded border" onClick={() => onOpenThread?.()}>Thread</button>
          <button className="text-xs px-2 py-1 rounded border" disabled={!qaId || voteBusy} onClick={() => void vote(1)}>Helpful ({data.helpful ?? 0})</button>
          <button className="text-xs px-2 py-1 rounded border" disabled={!qaId || voteBusy} onClick={() => void vote(-1)}>Not ({data.unhelpful ?? 0})</button>
          <button className="text-xs px-2 py-1 rounded border" disabled={!qaId} onClick={() => { if (qaId) onPinned?.(qaId); }}>Save to Right</button>
          {!editing ? (
            <button className="text-xs px-2 py-1 rounded border" onClick={() => { setEditing(true); setEditSummary(String(data.summary || "")); }}>Edit summary</button>
          ) : (
            <div className="flex items-center gap-2">
              <button className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50" disabled={saving || !editSummary.trim()} onClick={() => void saveSummary()}>{saving ? "Saving..." : "Save"}</button>
              <button className="text-xs px-2 py-1 rounded border" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          )}
        </div>
        {data.answer && <div className="text-sm whitespace-pre-wrap">A: {data.answer}</div>}
        {!editing && data.summary && <div className="text-xs text-gray-700 whitespace-pre-wrap">Summary: {data.summary}</div>}
        {editing && (
          <textarea className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" rows={4} value={editSummary} onChange={(e) => setEditSummary(e.target.value)} />
        )}
        <div className="mt-2">
          <div className="text-xs text-gray-600 mb-1">노트</div>
          <textarea
            className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
            rows={3}
            placeholder="참고/근거/메모"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            id="center-note"
            name="center-note"
          />
          <div className="mt-1">
            <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={!qaId || savingNote || !note.trim()} onClick={() => void saveNote()}>{savingNote ? "Saving..." : "저장"}</button>
          </div>
          {notes.length > 0 && (
            <ul className="mt-2 space-y-1">
              {notes.map((n) => (
                <li key={n.id} className="text-[11px] text-gray-700 whitespace-pre-wrap border rounded p-2">{n.content}</li>
              ))}
            </ul>
          )}
        </div>
        {patch && (
          <div className="mt-2">
            <PatchPreviewGraph patch={patch} />
          </div>
        )}
      </div>
    );
  }

  if (question && aiAnswer) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Q: {question}</div>
        <div className="text-sm whitespace-pre-wrap">AI Answer: {aiAnswer}</div>
        <div className="text-xs text-gray-600">요약을 작성하고 공유하면 지식 체계에 등록됩니다.</div>
        <textarea className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" rows={4} placeholder="핵심 요약을 작성하세요" value={newSummary} onChange={(e) => setNewSummary(e.target.value)} />
        <div className="flex items-center gap-2">
          <button className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50" disabled={saving} onClick={() => void shareNew()}>{saving ? "Sharing..." : "Share & Save to Right"}</button>
        </div>
      </div>
    );
  }

  if (question && !aiAnswer) {
    return <div className="text-xs text-gray-600">유사한 Q&A를 선택하거나 좌측에서 "지금 AI에게 묻기"를 눌러 답변을 받아보세요.</div>;
  }

  return <div className="text-xs text-gray-500">좌측에서 질문을 입력하세요.</div>;
}
