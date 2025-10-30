"use client";

import { useEffect, useRef, useState } from "react";

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

  useEffect(() => { setError(null); }, [qaId, question, aiAnswer]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (qaId) void shareUpdate(); else void shareNew();
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "e") {
        summaryRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qaId, summary, question, aiAnswer]);

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
      // get question text
      const r = await fetch(`/api/qa/${encodeURIComponent(qaId)}`);
      const d = await r.json().catch(() => null);
      const q = String(d?.question || "");
      if (!q) { setError("원본 질문을 불러올 수 없습니다."); setSaving(false); return; }
      const res = await fetch("/api/qa/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, summary: summary.trim() || undefined })
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
          <button className="text-xs px-3 py-2 rounded border" disabled={!qaId || voteBusy} onClick={() => void vote(1)}>Helpful</button>
          <button className="text-xs px-3 py-2 rounded border" disabled={!qaId || voteBusy} onClick={() => void vote(-1)}>Not helpful</button>
        </div>
      </div>
    </div>
  );
}
