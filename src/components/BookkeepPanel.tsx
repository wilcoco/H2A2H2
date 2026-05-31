"use client";

import { useState } from "react";

type Relation = { targetQaId: string; type: string; rationale: string; confidence: number };
type ForkCandidate = { reason: string; draftAnswer: string };
type Note = { qaId: string; content: string };
type Suggestion = {
  summary_update?: string;
  relations?: Relation[];
  fork_candidates?: ForkCandidate[];
  notes?: Note[];
};

type Props = {
  qaId: string;
  signedIn: boolean;
  onApplied?: () => void;
};

// "🔍 자동 정리" — Karpathy 식 LLM 북키핑 패널.
// LLM이 분석한 (요약 갱신/관계 후보/포크 후보/노트 후보)를 사용자가 개별 승인하여 적용.
// reconcile하지 않음: 모순은 fork 권장 (수렴 거부, 갈릴레오 보존).
export default function BookkeepPanel({ qaId, signedIn, onApplied }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Suggestion | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch("/api/ai/bookkeep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qaId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || "분석 실패"); return; }
      setData(j as Suggestion);
      if (!j.summary_update && (j.relations?.length ?? 0) === 0 && (j.fork_candidates?.length ?? 0) === 0 && (j.notes?.length ?? 0) === 0) {
        setMsg("제안 없음 — 가지에 통합할 만한 새 연결이 보이지 않습니다.");
      }
    } catch {
      setMsg("분석 실패");
    } finally {
      setLoading(false);
    }
  }

  async function applyRelation(rel: Relation, dir: "out" | "in") {
    setBusy(`rel:${rel.targetQaId}:${rel.type}:${dir}`);
    try {
      const sourceId = dir === "out" ? qaId : rel.targetQaId;
      const targetId = dir === "out" ? rel.targetQaId : qaId;
      const r = await fetch("/api/qa/relation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, targetId, type: rel.type, weight: 1 }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(j?.error || "관계 적용 실패"); return; }
      setMsg(`관계 ${rel.type} 적용 (${dir === "out" ? "→" : "←"})`);
      onApplied?.();
    } finally { setBusy(null); }
  }

  async function applyFork(f: ForkCandidate) {
    setBusy(`fork:${f.draftAnswer.slice(0, 16)}`);
    try {
      const r = await fetch("/api/qa/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: qaId, answer: f.draftAnswer }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || "포크 실패"); return; }
      setMsg(`포크 생성: ${j.id}`);
      onApplied?.();
    } finally { setBusy(null); }
  }

  async function applyNote(n: Note) {
    setBusy(`note:${n.qaId}`);
    try {
      const r = await fetch("/api/qa/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qaId: n.qaId, content: n.content }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || "노트 적용 실패"); return; }
      setMsg("노트 적용됨");
      onApplied?.();
    } finally { setBusy(null); }
  }

  return (
    <div className="text-[12px]">
      <div className="flex items-center gap-2 mb-2">
        <button
          className="text-[11px] px-2 py-1 rounded border border-violet-300 bg-white hover:bg-violet-50 disabled:opacity-50"
          onClick={run}
          disabled={loading || !signedIn}
          title={signedIn ? "기존 가지와 새 답을 LLM이 분석해 정리 제안" : "로그인 필요"}
        >{loading ? "분석 중…" : "🔍 자동 정리"}</button>
        {msg && <span className="text-gray-700">{msg}</span>}
      </div>

      {data && (
        <div className="flex flex-col gap-2">
          {data.summary_update && (
            <div className="border rounded p-2 bg-gray-50">
              <div className="text-[10px] text-gray-500 mb-0.5">요약 갱신 제안</div>
              <div className="text-[12px] text-gray-800 whitespace-pre-wrap">{data.summary_update}</div>
            </div>
          )}

          {data.relations && data.relations.length > 0 && (
            <div className="border rounded p-2">
              <div className="text-[10px] text-gray-500 mb-1">관계 제안 ({data.relations.length})</div>
              <ul className="flex flex-col gap-1">
                {data.relations.map((rel, i) => (
                  <li key={i} className="text-[11px] flex flex-wrap items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800">{rel.type}</span>
                    <span className="text-gray-500">confidence {Math.round(rel.confidence * 100)}%</span>
                    <button
                      className="text-[10px] px-1.5 py-0.5 rounded border hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => applyRelation(rel, "out")}
                      disabled={busy?.startsWith(`rel:${rel.targetQaId}:${rel.type}:`)}
                      title="이 노드 → 대상"
                    >→ 적용</button>
                    <button
                      className="text-[10px] px-1.5 py-0.5 rounded border hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => applyRelation(rel, "in")}
                      disabled={busy?.startsWith(`rel:${rel.targetQaId}:${rel.type}:`)}
                      title="대상 → 이 노드"
                    >← 적용</button>
                    <span className="basis-full text-gray-600">↳ target: <code className="text-[10px]">{rel.targetQaId}</code></span>
                    <span className="basis-full text-gray-700">{rel.rationale}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.fork_candidates && data.fork_candidates.length > 0 && (
            <div className="border rounded p-2 bg-blue-50/40">
              <div className="text-[10px] text-blue-700 mb-1">포크 후보 ({data.fork_candidates.length}) — reconcile 대신 분기 권장</div>
              <ul className="flex flex-col gap-2">
                {data.fork_candidates.map((f, i) => (
                  <li key={i} className="border rounded bg-white p-1.5">
                    <div className="text-[11px] text-gray-800">{f.reason}</div>
                    <pre className="text-[11px] text-gray-700 whitespace-pre-wrap mt-1">{f.draftAnswer}</pre>
                    <div className="flex justify-end mt-1">
                      <button
                        className="text-[10px] px-2 py-0.5 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
                        onClick={() => applyFork(f)}
                        disabled={busy?.startsWith("fork:")}
                      >⑂ 이 답으로 포크</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.notes && data.notes.length > 0 && (
            <div className="border rounded p-2">
              <div className="text-[10px] text-gray-500 mb-1">다른 노드에 노트 ({data.notes.length})</div>
              <ul className="flex flex-col gap-1.5">
                {data.notes.map((n, i) => (
                  <li key={i} className="text-[11px]">
                    <span className="text-gray-500">→ <code className="text-[10px]">{n.qaId}</code></span>
                    <div className="text-gray-700">{n.content}</div>
                    <button
                      className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded border hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => applyNote(n)}
                      disabled={busy === `note:${n.qaId}`}
                    >노트 등록</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
