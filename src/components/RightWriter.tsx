"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  qaId?: string;
  currentUserEmail?: string | null;
  onSaved?: () => void;
};

export default function RightWriter({ qaId, currentUserEmail, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [createdBy, setCreatedBy] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setError(null);
        setLoading(true);
        if (!qaId) { setTitle(""); setContentHtml(""); setCreatedBy(undefined); return; }
        const r = await fetch(`/api/qa/${encodeURIComponent(qaId)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!active) return;
        setTitle(String(j?.question || ""));
        const body = String(j?.summary || j?.answer || "");
        // Convert plain text to simple HTML with line breaks
        const html = body ? body.split("\n").map((line: string) => `<p>${escapeHtml(line)}</p>`).join("") : "";
        setContentHtml(html);
        setCreatedBy(j?.createdBy ? String(j.createdBy) : undefined);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message || "Failed to load");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [qaId]);

  function exec(cmd: string) {
    try { document.execCommand(cmd); } catch {}
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  }

  async function save() {
    if (!qaId) { setError("왼쪽에서 항목을 선택하세요."); return; }
    try {
      setSaving(true); setError(null);
      const textContent = (editorRef.current?.innerText || "").trim();
      const res = await fetch("/api/qa/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qaId, question: (title || "").trim() || undefined, summary: textContent || undefined })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Save failed");
      }
      // Regenerate keywords (words + phrases)
      try {
        await fetch("/api/qa/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, force: true, max: 8 }) });
      } catch {}
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">문서 작성</div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="text-[11px] text-gray-600">{qaId ? `Editing: ${qaId}` : "왼쪽에서 항목을 선택하세요."}</div>
      {(createdBy || currentUserEmail) && (
        <div className="text-[11px] text-gray-600">{createdBy ? `by ${createdBy}` : (currentUserEmail ? `by ${currentUserEmail}` : null)}</div>
      )}
      <div>
        <div className="text-xs text-gray-600 mb-1">제목</div>
        <input
          className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목을 입력하세요"
        />
      </div>
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="text-xs text-gray-600">내용</div>
          <div className="ml-auto flex items-center gap-1">
            <button className="text-[11px] px-2 py-0.5 rounded border" onClick={() => exec("bold")}>B</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" onClick={() => exec("italic")}>I</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" onClick={() => exec("insertUnorderedList")}>• List</button>
          </div>
        </div>
        <div
          ref={editorRef}
          className="min-h-[160px] rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => setContentHtml((e.target as HTMLDivElement).innerHTML)}
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      </div>
      <div className="flex items-center gap-2">
        <button className="text-xs px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={saving || !qaId} onClick={() => void save()}>{saving ? "Saving..." : "저장 (제목/내용/키워드)"}</button>
      </div>
    </div>
  );
}
