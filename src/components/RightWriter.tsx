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
  const lastRangeRef = useRef<Range | null>(null);

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

  useEffect(() => {
    // Ensure Enter creates paragraphs
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch {}
    function onSelChange() {
      try {
        const sel = window.getSelection();
        const ed = editorRef.current;
        if (!sel || sel.rangeCount === 0 || !ed) return;
        const node = sel.anchorNode as Node | null;
        if (node && (node === ed || ed.contains(node))) {
          lastRangeRef.current = sel.getRangeAt(0);
        }
      } catch {}
    }
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, []);

  function focusEditor() {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try {
      const sel = window.getSelection();
      if (sel && lastRangeRef.current) {
        sel.removeAllRanges();
        sel.addRange(lastRangeRef.current);
      }
    } catch {}
  }

  function exec(cmd: string, value?: string) {
    focusEditor();
    try { document.execCommand(cmd, false, value); } catch {}
    try { setContentHtml(editorRef.current?.innerHTML || ""); } catch {}
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
            <button className="text-[11px] px-2 py-0.5 rounded border" title="굵게" onClick={() => exec("bold")}>B</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="기울임" onClick={() => exec("italic")}>I</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="밑줄" onClick={() => exec("underline")}>U</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="취소선" onClick={() => exec("strikeThrough")}>S</button>
            <span className="mx-1 text-gray-300">|</span>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="H1" onClick={() => exec("formatBlock", "H1")}>H1</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="H2" onClick={() => exec("formatBlock", "H2")}>H2</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="인용" onClick={() => exec("formatBlock", "BLOCKQUOTE")}>❝</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="코드" onClick={() => exec("formatBlock", "PRE")}>{"< >"}</button>
            <span className="mx-1 text-gray-300">|</span>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="불릿" onClick={() => exec("insertUnorderedList")}>• List</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="번호" onClick={() => exec("insertOrderedList")}>1. List</button>
            <span className="mx-1 text-gray-300">|</span>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="링크" onClick={() => { const u = prompt("URL"); if (u) exec("createLink", u); }}>🔗</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="실행 취소" onClick={() => exec("undo")}>↶</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="다시 실행" onClick={() => exec("redo")}>↷</button>
            <span className="mx-1 text-gray-300">|</span>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="서식 제거" onClick={() => exec("removeFormat")}>Tx</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" title="모두 지우기" onClick={() => { if (editorRef.current) { editorRef.current.innerHTML = ""; setContentHtml(""); } }}>Clear</button>
          </div>
        </div>
        <div
          ref={editorRef}
          className="min-h-[160px] rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
          onInput={(e) => setContentHtml((e.target as HTMLDivElement).innerHTML)}
          onMouseUp={() => {
            try {
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) lastRangeRef.current = sel.getRangeAt(0);
            } catch {}
          }}
          onKeyUp={() => {
            try {
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) lastRangeRef.current = sel.getRangeAt(0);
            } catch {}
          }}
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      </div>
      <div className="flex items-center gap-2">
        <button className="text-xs px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={saving || !qaId} onClick={() => void save()}>{saving ? "Saving..." : "저장 (제목/내용/키워드)"}</button>
      </div>
    </div>
  );
}
