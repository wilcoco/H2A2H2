"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  qaId?: string;
  centerQaId?: string;
  centerChainIds?: string[];
  currentUserEmail?: string | null;
  onSetQaId?: (id: string) => void;
  onSaved?: () => void;
  aiQuestion?: string;
  aiAnswer?: string;
};

export default function RightWriter({ qaId, centerQaId, centerChainIds, currentUserEmail, onSetQaId, onSaved, aiQuestion, aiAnswer }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [createdBy, setCreatedBy] = useState<string | undefined>(undefined);
  const lastRangeRef = useRef<Range | null>(null);
  type RefBlock = { id: string; type: 'ref'; qaId: string };
  type ChecklistItem = { id: string; text: string; done: boolean };
  type ChecklistBlock = { id: string; type: 'checklist'; items: ChecklistItem[] };
  type DecisionBlock = { id: string; type: 'decision'; what: string; why: string; options: string[]; owner?: string; due?: string };
  type CompareBlock = { id: string; type: 'compare'; options: string[]; criteria: string[]; cells: string[][] };
  type Block = RefBlock | ChecklistBlock | DecisionBlock | CompareBlock;
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [meta, setMeta] = useState<{ reliability?: string; source?: string; freshness?: string }>({});
  const [toast, setToast] = useState<string | null>(null);
  function uid(p = 'blk_') { return p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }

  // Helper to insert red text at current caret, preserving selection
  function insertRedText(text: string) {
    const ed = editorRef.current;
    if (!ed) return;
    const sel = window.getSelection();
    if (!sel) return;
    let range: Range | null = null;
    if (sel.rangeCount > 0) {
      range = sel.getRangeAt(0);
    } else if (lastRangeRef.current) {
      range = lastRangeRef.current;
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(ed);
      range.collapse(false);
    }
    const container = range.commonAncestorContainer as Node;
    if (!ed.contains(container)) {
      const endRange = document.createRange();
      endRange.selectNodeContents(ed);
      endRange.collapse(false);
      range = endRange;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const span = document.createElement("span");
      span.style.color = "#dc2626";
      if (lines[i] === " ") span.innerHTML = "&nbsp;"; else span.textContent = lines[i];
      range.deleteContents();
      range.insertNode(span);
      range.setStartAfter(span);
      range.collapse(true);
      if (i < lines.length - 1) {
        const br = document.createElement("br");
        range.insertNode(br);
        range.setStartAfter(br);
        range.collapse(true);
      }
    }
    sel.removeAllRanges();
    sel.addRange(range);
    lastRangeRef.current = range.cloneRange();
  }

  async function fetchQa(id: string): Promise<{ question: string; summary?: string; answer?: string; createdBy?: string; patch?: unknown } | null> {
    try {
      const r = await fetch(`/api/qa/${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!j) return null;
      return { question: String(j.question || ""), summary: j.summary ? String(j.summary) : undefined, answer: j.answer ? String(j.answer) : undefined, createdBy: j.createdBy ? String(j.createdBy) : undefined, patch: j.patch ?? undefined };
    } catch { return null; }
  }

  function setTargetFromCenter() {
    if (!centerQaId) return;
    onSetQaId?.(centerQaId);
  }

  async function appendFromCenter() {
    if (!centerQaId) return;
    const data = await fetchQa(centerQaId);
    if (!data) return;
    const block = [
      `<p><strong>Q:</strong> ${escapeHtml(data.question)}</p>`,
      ...(data.summary || data.answer ? [
        `<div>${escapeHtml(String(data.summary || data.answer || "")).replace(/\n/g, "<br/>")}</div>`
      ] : [])
    ].join("");
    const next = (editorRef.current?.innerHTML || contentHtml || "") + (block ? `<hr/>${block}` : "");
    if (editorRef.current) editorRef.current.innerHTML = next;
    setContentHtml(next);
  }

  function addRefFromCenter() {
    if (!centerQaId) return;
    setBlocks((arr) => [...arr, { id: uid(), type: 'ref', qaId: centerQaId } as RefBlock]);
  }

  function addChecklist() { setBlocks((arr) => [...arr, { id: uid(), type: 'checklist', items: [{ id: uid('it_'), text: '', done: false }] } as ChecklistBlock]); }
  function addDecision() { setBlocks((arr) => [...arr, { id: uid(), type: 'decision', what: '', why: '', options: [''], owner: '', due: '' } as DecisionBlock]); }
  function addCompare() { setBlocks((arr) => [...arr, { id: uid(), type: 'compare', options: ['A','B'], criteria: ['기준1','기준2'], cells: [["",""],["",""]] } as CompareBlock]); }

  function moveBlock(i: number, dir: -1 | 1) {
    setBlocks((arr) => {
      const j = i + dir; if (j < 0 || j >= arr.length) return arr;
      const c = arr.slice(); const t = c[i]; c[i] = c[j]; c[j] = t; return c;
    });
  }
  function removeBlock(i: number) { setBlocks((arr) => arr.filter((_, idx) => idx !== i)); }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setError(null);
        setLoading(true);
        if (!qaId) { setTitle(""); setContentHtml(""); setCreatedBy(undefined); setBlocks([]); setMeta({}); return; }
        const data = await fetchQa(qaId);
        if (!active || !data) return;
        setTitle(String(data.question || ""));
        const body = String(data.summary || data.answer || "");
        const html = body ? body.split("\n").map((line: string) => `<p>${escapeHtml(line)}</p>`).join("") : "";
        setContentHtml(html);
        setCreatedBy(data.createdBy);
        // Safely read patch.blocks and patch.meta
        const patchObj = (data.patch && typeof data.patch === 'object') ? (data.patch as Record<string, unknown>) : null;
        if (patchObj && Array.isArray(patchObj['blocks'])) {
          setBlocks(patchObj['blocks'] as Block[]);
        } else {
          setBlocks([]);
        }
        if (patchObj && typeof patchObj['meta'] === 'object' && patchObj['meta'] !== null) {
          const m = patchObj['meta'] as { reliability?: unknown; source?: unknown; freshness?: unknown };
          setMeta({
            reliability: typeof m.reliability === 'string' ? m.reliability : undefined,
            source: typeof m.source === 'string' ? m.source : undefined,
            freshness: typeof m.freshness === 'string' ? m.freshness : undefined,
          });
        } else setMeta({});
      } catch (e: unknown) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally { if (active) setLoading(false); }
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
    document.addEventListener("selectionchange", onSelChange as EventListener);
    return () => document.removeEventListener("selectionchange", onSelChange as EventListener);
  }, []);

  // Sync editor content with the currently visible center chain whenever it changes
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!centerChainIds || centerChainIds.length === 0) return;
        const arr = await Promise.all(centerChainIds.map((id) => fetchQa(id)));
        const parts: string[] = [];
        arr.forEach((data, idx) => {
          if (!data) return;
          parts.push(`<p><strong>Q${idx + 1}:</strong> ${escapeHtml(data.question)}</p>`);
          const body = String(data.summary || data.answer || "");
          if (body) parts.push(`<div>${escapeHtml(body).replace(/\n/g, "<br/>")}</div>`);
          if (idx < arr.length - 1) parts.push("<hr/>");
        });
        const html = parts.join("");
        if (!active) return;
        if (editorRef.current) editorRef.current.innerHTML = html;
        setContentHtml(html);
      } catch {}
    })();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(centerChainIds)]);

  useEffect(() => {
    if (qaId) return;
    const q = (aiQuestion || "").trim();
    const a = (aiAnswer || "").trim();
    if (!q && !a) return;
    const html = [q ? `<p><strong>Q:</strong> ${escapeHtml(q)}</p>` : "", a ? `<div>${escapeHtml(a).replace(/\n/g, "<br/>")}</div>` : ""].filter(Boolean).join("");
    if (editorRef.current) editorRef.current.innerHTML = html;
    setContentHtml(html);
    if (q) setTitle(q);
  }, [qaId, aiQuestion, aiAnswer]);

  // Make newly typed/pasted edits appear in red
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    function onBeforeInput(e: InputEvent) {
      const it = (e as InputEvent).inputType;
      if (it === "insertText" || it === "insertCompositionText" || it === "insertParagraph") {
        try { document.execCommand("styleWithCSS", false, "true"); } catch {}
        try { document.execCommand("foreColor", false, "#dc2626"); } catch {}
      }
    }
    function onPaste(e: ClipboardEvent) {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") || "";
      if (text) insertRedText(text);
    }
    el.addEventListener("beforeinput", onBeforeInput as EventListener, true);
    el.addEventListener("paste", onPaste as EventListener);
    return () => {
      el.removeEventListener("beforeinput", onBeforeInput as EventListener, true);
      el.removeEventListener("paste", onPaste as EventListener);
    };
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

  function applyBlock(tag: 'H1'|'H2'|'BLOCKQUOTE'|'PRE'|'P') {
    const ed = editorRef.current; if (!ed) return;
    focusEditor();
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      let node: Node | null = sel.anchorNode;
      while (node && node !== ed && (node as HTMLElement).nodeType === 1 && !(node as HTMLElement).isContentEditable) node = node.parentNode;
      while (node && node !== ed) {
        if (node instanceof HTMLElement) {
          const tn = node.tagName.toUpperCase();
          if (['P','DIV','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','LI'].includes(tn)) {
            const current = node as HTMLElement;
            const desired = tag === 'P' ? 'P' : tag;
            const already = tn === desired;
            const newTag = already ? 'P' : desired;
            const repl = document.createElement(newTag);
            repl.innerHTML = current.innerHTML;
            current.replaceWith(repl);
            const r = document.createRange(); r.selectNodeContents(repl); r.collapse(false);
            sel.removeAllRanges(); sel.addRange(r);
            lastRangeRef.current = r.cloneRange();
            break;
          }
        }
        node = node?.parentNode || null;
      }
    } catch {}
    try { setContentHtml(ed.innerHTML); } catch {}
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  }

  async function save() {
    if (!qaId) { setError("왼쪽에서 항목을 선택하세요."); return; }
    try {
      setSaving(true); setError(null);
      const textContent = (editorRef.current?.innerText || "").trim();
      const patch = { blocks, meta };
      const res = await fetch("/api/qa/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qaId, question: (title || "").trim() || undefined, summary: textContent || undefined, patch })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(err && typeof err.error === 'string' ? err.error : "Save failed");
      }
      // Regenerate keywords (words + phrases)
      try {
        await fetch("/api/qa/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, force: true, max: 8 }) });
      } catch {}
      onSaved?.();
      setToast("저장 완료");
      setTimeout(() => setToast(null), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">문서 작성</div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      {/* blocks hidden */}
      {/* labels hidden */}
      <div className="text-[11px] text-gray-600">{qaId ? `Editing: ${qaId}` : "오른쪽 상단에서 대상 설정 또는 좌측 선택 후 '대상=센터'를 누르세요."}</div>
      {(createdBy || currentUserEmail) && (
        <div className="text-[11px] text-gray-600">{createdBy ? `by ${createdBy}` : (currentUserEmail ? `by ${currentUserEmail}` : null)}</div>
      )}
      <div className="flex items-center gap-2">
        <button className="text-[11px] px-2 py-1 rounded border" disabled={!centerQaId} onClick={() => void setTargetFromCenter()}>대상=센터</button>
        <button className="text-[11px] px-2 py-1 rounded border" disabled={!centerQaId} onClick={() => void appendFromCenter()}>센터 내용 추가</button>
        <button className="text-[11px] px-2 py-1 rounded border" disabled={!centerQaId} onClick={() => addRefFromCenter()}>센터 참조 추가</button>
      </div>
      <div>
        <div className="text-xs text-gray-600 mb-1">제목</div>
        <input
          className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목을 입력하세요"
        />
      </div>
      <div className="flex items-start gap-2 mb-1 flex-wrap">
        <div className="text-xs text-gray-600 mt-1">내용</div>
        <div className="flex-1 flex flex-wrap items-center gap-1">
          <button className="text-[11px] px-2 py-0.5 rounded border" title="굵게" onMouseDown={(e)=>e.preventDefault()} onClick={() => exec("bold")}>B</button>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="기울임" onMouseDown={(e)=>e.preventDefault()} onClick={() => exec("italic")}>I</button>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="밑줄" onMouseDown={(e)=>e.preventDefault()} onClick={() => exec("underline")}>U</button>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="취소선" onMouseDown={(e)=>e.preventDefault()} onClick={() => exec("strikeThrough")}>S</button>
          <span className="mx-1 text-gray-300">|</span>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="H1" onMouseDown={(e)=>e.preventDefault()} onClick={() => applyBlock('H1')}>H1</button>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="H2" onMouseDown={(e)=>e.preventDefault()} onClick={() => applyBlock('H2')}>H2</button>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="인용" onMouseDown={(e)=>e.preventDefault()} onClick={() => applyBlock('BLOCKQUOTE')}>❝</button>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="코드" onMouseDown={(e)=>e.preventDefault()} onClick={() => applyBlock('PRE')}>{"< >"}</button>
          <span className="mx-1 text-gray-300">|</span>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="불릿" onMouseDown={(e)=>e.preventDefault()} onClick={() => exec("insertUnorderedList")}>• List</button>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="번호" onMouseDown={(e)=>e.preventDefault()} onClick={() => exec("insertOrderedList")}>1. List</button>
          <span className="mx-1 text-gray-300">|</span>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="링크" onMouseDown={(e)=>e.preventDefault()} onClick={() => { const u = prompt("URL"); if (u) exec("createLink", u); }}>🔗</button>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="실행 취소" onMouseDown={(e)=>e.preventDefault()} onClick={() => exec("undo")}>↶</button>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="다시 실행" onMouseDown={(e)=>e.preventDefault()} onClick={() => exec("redo")}>↷</button>
          <span className="mx-1 text-gray-300">|</span>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="서식 제거" onMouseDown={(e)=>e.preventDefault()} onClick={() => exec("removeFormat")}>Tx</button>
          <button className="text-[11px] px-2 py-0.5 rounded border" title="모두 지우기" onMouseDown={(e)=>e.preventDefault()} onClick={() => { if (editorRef.current) { editorRef.current.innerHTML = ""; setContentHtml(""); } }}>Clear</button>
        </div>
      </div>
      <div
        ref={editorRef}
        className="min-h-[160px] rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60 whitespace-pre-wrap break-words"
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
        onInput={() => {
          // Avoid setting state on each keystroke to prevent caret jump
        }}
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
      <div className="flex items-center gap-2">
        <button className="text-xs px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={saving || !qaId} onClick={() => void save()}>{saving ? "Saving..." : "저장 (제목/내용/키워드)"}</button>
      </div>
      {toast && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white text-xs px-3 py-2 rounded shadow">{toast}</div>
      )}
    </div>
  );
}
