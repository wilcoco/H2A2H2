"use client";

import { useEffect, useRef, useState } from "react";
import type { QAEntry } from "@/types/graph";

type Props = {
  qaId?: string;
  question?: string;
  aiAnswer?: string;
  user?: { email: string; name?: string };
  onRequireLogin?: () => void;
  onShared: (id: string) => void;
};

export default function RightEditor({ qaId, question, aiAnswer, user, onRequireLogin, onShared }: Props) {
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLTextAreaElement | null>(null);
  const [relType, setRelType] = useState<string>("precedes");
  const [relQuery, setRelQuery] = useState<string>("");
  const [relResults, setRelResults] = useState<QAEntry[]>([]);
  const [relTargetId, setRelTargetId] = useState<string | null>(null);
  const [relBusy, setRelBusy] = useState(false);
  const relAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { setError(null); }, [qaId, question, aiAnswer]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (qaId) void shareUpdate(); else void shareNew();
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "e") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const isTyping = tag === "input" || tag === "textarea" || tag === "select" || (!!target && target.isContentEditable);
        if (isTyping) return; // don't steal focus while user is typing elsewhere
        summaryRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qaId, summary, question, aiAnswer]);

  async function searchRel(q: string) {
    const query = q.trim();
    if (!query) { setRelResults([]); relAbortRef.current?.abort(); return; }
    try {
      relAbortRef.current?.abort();
      const controller = new AbortController();
      relAbortRef.current = controller;
      const res = await fetch("/api/qa/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 8, strict: true }),
        cache: "no-store",
        signal: controller.signal,
      });
      const j = await res.json().catch(() => ({ items: [] }));
      const its: QAEntry[] = Array.isArray(j?.items) ? (j.items as QAEntry[]) : [];
      setRelResults(its);
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === "AbortError") return;
    }
  }

  useEffect(() => {
    const t = setTimeout(() => { void searchRel(relQuery); }, 250);
    return () => clearTimeout(t);
  }, [relQuery]);

  async function connectRelation() {
    if (!qaId || !relTargetId || !relType) return;
    try {
      setRelBusy(true);
      const res = await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: qaId, targetId: relTargetId, type: relType, weight: 1 }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Connect failed");
      }
      setRelTargetId(null);
      setRelQuery("");
      setRelResults([]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setRelBusy(false);
    }
  }

  async function shareNew() {
    const q = (question || "").trim();
    if (!q) { setError("질문이 없습니다."); return; }
    try {
      setSaving(true);
      const res = await fetch("/api/qa/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, answer: aiAnswer || undefined, summary: summary.trim() || undefined })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Share failed");
      }
      const j = await res.json();
      if (j?.id) onShared(j.id as string);
      setSummary("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function shareUpdate() {
    if (!qaId) return;
    try {
      setSaving(true);
      const res = await fetch("/api/qa/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qaId, summary: summary.trim() || undefined })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Update failed");
      }
      onShared(qaId);
      setSummary("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    const content = note.trim();
    if (!qaId || !content) return;
    try {
      setSaving(true);
      const res = await fetch("/api/qa/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, content }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Note failed");
      }
      setNote("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function vote(v: 1 | -1) {
    if (!qaId) return;
    if (!user) { onRequireLogin?.(); return; }
    try {
      setVoteBusy(true);
      const res = await fetch("/api/qa/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, vote: v }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Vote failed");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setVoteBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">편집 / 평가</div>
      {error && <div className="text-xs text-red-600">{error}</div>}

      <div>
        <div className="text-xs text-gray-600 mb-1">요약 / 정리</div>
        <textarea
          className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
          rows={6}
          placeholder="핵심 요약, 보완 내용, 결론 등을 작성하세요."
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          ref={summaryRef}
        />
        <div className="mt-2 flex items-center gap-2">
          {qaId ? (
            <button className="text-xs px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={saving || summary.trim().length === 0} onClick={() => void shareUpdate()}>
              {saving ? "Sharing..." : "Share Q&A(업데이트)"}
            </button>
          ) : (
            <button className="text-xs px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={saving || (question || "").trim().length === 0} onClick={() => void shareNew()}>
              {saving ? "Sharing..." : "Share Q&A"}
            </button>
          )}
        </div>
      </div>

      <div>
        <div className="text-xs text-gray-600 mb-1">노트</div>
        <textarea
          className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
          rows={4}
          placeholder="참고/근거/메모"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-2">
          <button className="text-xs px-3 py-2 rounded border disabled:opacity-50" disabled={saving || !qaId || note.trim().length === 0} onClick={() => void saveNote()}>저장</button>
        </div>
      </div>

      <div>
        <div className="text-xs text-gray-600 mb-1">평가</div>
        <div className="flex items-center gap-2">
          <button className="text-xs px-3 py-2 rounded border" disabled={!qaId || voteBusy} onClick={() => void vote(1)}>도움됨</button>
          <button className="text-xs px-3 py-2 rounded border" disabled={!qaId || voteBusy} onClick={() => void vote(-1)}>도움 안됨</button>
        </div>
      </div>

      <div>
        <div className="text-xs text-gray-600 mb-1">질문 간 관계</div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="text-xs border rounded px-2 py-1" value={relType} onChange={(e) => setRelType(e.target.value)}>
            <option value="precedes">precedes</option>
            <option value="prerequisite">prerequisite</option>
            <option value="narrows">narrows</option>
            <option value="elaborates">elaborates</option>
            <option value="clarifies">clarifies</option>
            <option value="supports">supports</option>
            <option value="refutes">refutes</option>
            <option value="alternative">alternative</option>
          </select>
          <input
            className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
            placeholder="연결할 기존 질문 찾기"
            value={relQuery}
            onChange={(e) => setRelQuery(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.preventDefault(); }}
            id="rel-search"
            name="rel-search"
          />
          <button className="text-xs px-3 py-2 rounded border disabled:opacity-50" disabled={!qaId || !relTargetId || relBusy} onClick={() => void connectRelation()}>{relBusy ? "Connecting..." : "Connect"}</button>
        </div>
        {relResults.length > 0 && (
          <ul className="mt-2 space-y-1 max-h-40 overflow-auto">
            {relResults.map((it) => (
              <li key={it.id} className={`p-2 rounded border text-xs flex items-center justify-between gap-2 ${relTargetId === it.id ? "bg-gray-50" : ""}`}>
                <div className="min-w-0 truncate">Q: {it.question}</div>
                <button className="text-[11px] px-2 py-1 rounded border shrink-0" onClick={() => setRelTargetId(it.id)}>{relTargetId === it.id ? "선택됨" : "선택"}</button>
              </li>
            ))}
          </ul>
        )}
        {relQuery.trim().length > 0 && relResults.length === 0 && (
          <div className="text-[11px] text-gray-600 mt-1">유사한 Q&A가 없습니다.</div>
        )}
        {!qaId && (
          <div className="text-[11px] text-gray-600 mt-1">먼저 Q&A를 공유하여 ID를 생성하세요.</div>
        )}
      </div>
    </div>
  );
}
