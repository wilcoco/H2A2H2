"use client";

import { useEffect, useState } from "react";

type ThreadNode = {
  id: string;
  parentId?: string;
  question: string;
  hasAnswer: boolean;
  helpful: number;
  unhelpful: number;
  myVote: number;
  children: ThreadNode[];
};

type Props = {
  qaId?: string;
  open: boolean;
  onClose: () => void;
};

export default function ThreadDrawer({ qaId, open, onClose }: Props) {
  const [rootId, setRootId] = useState<string | null>(null);
  const [tree, setTree] = useState<ThreadNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followupText, setFollowupText] = useState<Record<string, string>>({});
  const [busyVote, setBusyVote] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!open || !qaId) { setRootId(null); setTree(null); return; }
      try {
        setLoading(true); setError(null);
        const r = await fetch(`/api/qa/${encodeURIComponent(qaId)}`);
        if (!r.ok) throw new Error("Failed to load QA detail");
        const d = await r.json();
        const rid: string = d?.rootId || d?.id;
        setRootId(rid);
        const t = await fetch(`/api/qa/thread?rootId=${encodeURIComponent(rid)}&depth=3`, { cache: "no-store" });
        if (!t.ok) throw new Error("Failed to load thread");
        const tj = await t.json();
        setTree(tj?.root ?? null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally { setLoading(false); }
    }
    void load();
    return () => { mounted = false; };
  }, [open, qaId]);

  async function sendVote(qaId: string, v: 1 | -1) {
    try {
      setBusyVote((m) => ({ ...m, [qaId]: true }));
      const res = await fetch("/api/qa/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, vote: v }) });
      if (!res.ok) throw new Error("Vote failed");
      if (rootId) await refresh();
    } catch {}
    finally { setBusyVote((m) => ({ ...m, [qaId]: false })); }
  }

  async function addFollowup(parentId: string) {
    try {
      const text = (followupText[parentId] || "").trim();
      if (!text) return;
      const res = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, parentId }) });
      if (!res.ok) throw new Error("Share failed");
      setFollowupText((m) => ({ ...m, [parentId]: "" }));
      await refresh();
    } catch {}
  }

  async function aiAnswer(id: string, q: string) {
    try {
      const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: q, history: [] }) });
      if (!r.ok) throw new Error("AI failed");
      const j = await r.json();
      const answer = String(j?.answer || "");
      if (!answer) return;
      const u = await fetch("/api/qa/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId: id, answer }) });
      if (!u.ok) throw new Error("Save failed");
      await refresh();
    } catch {}
  }

  async function refresh() {
    if (!rootId) return;
    try {
      setLoading(true);
      const t = await fetch(`/api/qa/thread?rootId=${encodeURIComponent(rootId)}&depth=3`, { cache: "no-store" });
      if (!t.ok) throw new Error("Failed to load thread");
      const tj = await t.json();
      setTree(tj?.root ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }

  function NodeItem({ node }: { node: ThreadNode }) {
    const fid = node.id;
    const fval = followupText[fid] || "";
    return (
      <div className="border-l pl-3 ml-1 my-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">Q: {node.question}</div>
            <div className="text-[11px] text-gray-600 mt-0.5">{node.hasAnswer ? "답변 있음" : "미답변"}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button className="text-[11px] px-2 py-1 rounded border" disabled={!!busyVote[fid]} onClick={() => void sendVote(fid, 1)}>Helpful ({node.helpful})</button>
            <button className="text-[11px] px-2 py-1 rounded border" disabled={!!busyVote[fid]} onClick={() => void sendVote(fid, -1)}>Not ({node.unhelpful})</button>
            {!node.hasAnswer && (
              <button className="text-[11px] px-2 py-1 rounded border" onClick={() => void aiAnswer(fid, node.question)}>AI 답변 생성</button>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="flex-1 rounded border border-gray-300 bg-white/90 p-1 text-xs dark:bg-gray-900/60"
            placeholder="후속 질문 추가"
            value={fval}
            onChange={(e) => setFollowupText((m) => ({ ...m, [fid]: e.target.value }))}
          />
          <button className="text-[11px] px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={!fval.trim()} onClick={() => void addFollowup(fid)}>추가</button>
        </div>
        {node.children?.length > 0 && (
          <div className="mt-2">
            {node.children.map((ch) => (<NodeItem key={ch.id} node={ch} />))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`fixed inset-y-0 right-0 w-full sm:w-[420px] transform ${open ? "translate-x-0" : "translate-x-full"} transition-transform duration-200 z-40`}>
      <div className="h-full bg-white dark:bg-gray-900 border-l border-gray-200/60 flex flex-col">
        <div className="p-2 border-b flex items-center justify-between">
          <div className="text-sm font-semibold">Follow-ups Thread</div>
          <div className="flex items-center gap-2">
            <button className="text-xs px-2 py-1 rounded border" onClick={() => void refresh()}>Refresh</button>
            <button className="text-xs px-2 py-1 rounded border" onClick={onClose}>Close (F)</button>
          </div>
        </div>
        <div className="p-2 overflow-auto flex-1">
          {loading && <div className="text-xs text-gray-500">불러오는 중...</div>}
          {error && <div className="text-xs text-red-600">{error}</div>}
          {!loading && !error && tree && <NodeItem node={tree} />}
          {!loading && !error && !tree && <div className="text-xs text-gray-500">스레드가 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}
