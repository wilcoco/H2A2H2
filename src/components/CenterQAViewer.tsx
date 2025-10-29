"use client";

import { useEffect, useState } from "react";
import type { LlmPatch, NodeType, EdgeType } from "@/types/graph";

type Props = {
  qaId?: string;
  question?: string;
  aiAnswer?: string;
  onOpenThread?: () => void;
};

export default function CenterQAViewer({ qaId, question, aiAnswer, onOpenThread }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any | null>(null);

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
        <div>
          <button className="text-xs px-2 py-1 rounded border" onClick={() => onOpenThread?.()}>Follow-ups</button>
        </div>
        {data.answer && <div className="text-sm whitespace-pre-wrap">A: {data.answer}</div>}
        {data.summary && <div className="text-xs text-gray-700 whitespace-pre-wrap">Summary: {data.summary}</div>}
        <div className="text-[11px] text-gray-600">Helpful {data.helpful ?? 0} · Not {data.unhelpful ?? 0}</div>
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
        <div className="text-[11px] text-gray-600">좌측에서 다른 Q&A를 클릭해 검증된 답변을 볼 수 있습니다.</div>
      </div>
    );
  }

  if (question && !aiAnswer) {
    return <div className="text-xs text-gray-600">유사한 Q&A를 선택하거나 좌측에서 "지금 AI에게 묻기"를 눌러 답변을 받아보세요.</div>;
  }

  return <div className="text-xs text-gray-500">좌측에서 질문을 입력하세요.</div>;
}
