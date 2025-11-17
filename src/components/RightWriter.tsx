"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  qaId?: string;
  centerQaId?: string;
  centerChainIds?: string[];
  currentUserEmail?: string | null;
  onSetQaId?: (id: string) => void;
  onSaved?: () => void;
};

export default function RightWriter({ qaId, centerQaId, centerChainIds, currentUserEmail, onSetQaId, onSaved }: Props) {
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
  function uid(p = 'blk_') { return p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }

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

  // Auto-populate editor with the currently visible center chain (root→leaf)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!centerChainIds || centerChainIds.length === 0) return;
        const el = editorRef.current;
        const isEmpty = !el || ((el.innerText || "").trim().length === 0 && (contentHtml || "").trim().length === 0);
        if (!isEmpty) return; // don't override existing edits
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

  // Make newly typed/pasted edits appear in red
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    function insertRed(text: string) {
      const safe = escapeHtml(text);
      try { document.execCommand("insertHTML", false, `<span style="color:#dc2626">${safe}</span>`); } catch {}
      try { setContentHtml(editorRef.current?.innerHTML || ""); } catch {}
    }
    function onBeforeInput(e: InputEvent) {
      try { if ((e as InputEvent).isComposing) return; } catch {}
      if (e.inputType === "insertText" && typeof e.data === "string" && e.data.length > 0) {
        e.preventDefault();
        insertRed(e.data);
      }
    }
    function onPaste(e: ClipboardEvent) {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") || "";
      if (text) insertRed(text);
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
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="text-xs text-gray-600">블록</div>
          <div className="ml-auto flex items-center gap-1">
            <button className="text-[11px] px-2 py-0.5 rounded border" onClick={() => addChecklist()}>체크리스트 추가</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" onClick={() => addDecision()}>결정 추가</button>
            <button className="text-[11px] px-2 py-0.5 rounded border" onClick={() => addCompare()}>비교표 추가</button>
          </div>
        </div>
        {blocks.length === 0 ? (
          <div className="text-[11px] text-gray-500">블록이 없습니다.</div>
        ) : (
          <ul className="space-y-2">
            {blocks.map((b, i) => (
              <li key={b.id} className="rounded border p-2 text-[12px] bg-white/60 dark:bg-gray-900/40">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-[11px] text-gray-600">{b.type}</div>
                  <div className="ml-auto flex items-center gap-1">
                    <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => moveBlock(i, -1)}>위</button>
                    <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => moveBlock(i, +1)}>아래</button>
                    <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => removeBlock(i)}>삭제</button>
                  </div>
                </div>
                {b.type === 'ref' && (
                  <div className="flex items-center gap-2">
                    <div className="text-[11px]">참조 QA ID</div>
                    <input className="text-xs border rounded px-2 py-1 flex-1" value={(b as RefBlock).qaId} onChange={(e) => {
                      const v = e.target.value; setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as RefBlock), qaId: v }) as Block : x));
                    }} />
                  </div>
                )}
                {b.type === 'checklist' && (
                  <div className="space-y-1">
                    {(b as ChecklistBlock).items.map((it, j) => (
                      <div key={it.id} className="flex items-center gap-2">
                        <input type="checkbox" checked={it.done} onChange={(e) => {
                          setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as ChecklistBlock), items: (x as ChecklistBlock).items.map((y, jj) => jj === j ? { ...y, done: e.target.checked } : y) }) as Block : x));
                        }} />
                        <input className="text-xs border rounded px-2 py-1 flex-1" value={it.text} onChange={(e) => {
                          const v = e.target.value; setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as ChecklistBlock), items: (x as ChecklistBlock).items.map((y, jj) => jj === j ? { ...y, text: v } : y) }) as Block : x));
                        }} />
                        <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => {
                          setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as ChecklistBlock), items: (x as ChecklistBlock).items.filter((_, jj) => jj !== j) }) as Block : x));
                        }}>삭제</button>
                      </div>
                    ))}
                    <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => {
                      setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as ChecklistBlock), items: [...(x as ChecklistBlock).items, { id: uid('it_'), text: '', done: false }] }) as Block : x));
                    }}>항목 추가</button>
                  </div>
                )}
                {b.type === 'decision' && (
                  <div className="space-y-1">
                    <input className="text-xs border rounded px-2 py-1 w-full" placeholder="무엇(결정)" value={(b as DecisionBlock).what} onChange={(e) => setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as DecisionBlock), what: e.target.value }) as Block : x))} />
                    <textarea className="text-xs border rounded px-2 py-1 w-full" placeholder="왜(배경/근거)" value={(b as DecisionBlock).why} onChange={(e) => setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as DecisionBlock), why: e.target.value }) as Block : x))} />
                    <div className="flex items-center gap-2">
                      <input className="text-xs border rounded px-2 py-1 flex-1" placeholder="담당자" value={(b as DecisionBlock).owner || ''} onChange={(e) => setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as DecisionBlock), owner: e.target.value }) as Block : x))} />
                      <input className="text-xs border rounded px-2 py-1" type="date" value={(b as DecisionBlock).due || ''} onChange={(e) => setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as DecisionBlock), due: e.target.value }) as Block : x))} />
                    </div>
                    <div className="space-y-1">
                      {(b as DecisionBlock).options.map((op, j) => (
                        <div key={j} className="flex items-center gap-2">
                          <input className="text-xs border rounded px-2 py-1 flex-1" value={op} onChange={(e) => setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as DecisionBlock), options: (x as DecisionBlock).options.map((oo, jj) => jj === j ? e.target.value : oo) }) as Block : x))} />
                          <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as DecisionBlock), options: (x as DecisionBlock).options.filter((_, jj) => jj !== j) }) as Block : x))}>삭제</button>
                        </div>
                      ))}
                      <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => setBlocks((arr) => arr.map((x, idx) => idx === i ? ({ ...(x as DecisionBlock), options: [...(x as DecisionBlock).options, ''] }) as Block : x))}>옵션 추가</button>
                    </div>
                  </div>
                )}
                {b.type === 'compare' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="text-[11px]">옵션</div>
                      <input className="text-xs border rounded px-2 py-1" value={(b as CompareBlock).options.join(', ')} onChange={(e) => {
                        const arr = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                        setBlocks((prev) => prev.map((x, idx) => {
                          if (idx !== i) return x; const cb = x as CompareBlock;
                          const cols = arr.length; const rows = cb.criteria.length;
                          const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (__, c) => (cb.cells[r]?.[c] ?? '')));
                          return { ...cb, options: arr, cells } as Block;
                        }));
                      }} />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[11px]">기준</div>
                      <input className="text-xs border rounded px-2 py-1" value={(b as CompareBlock).criteria.join(', ')} onChange={(e) => {
                        const arr = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                        setBlocks((prev) => prev.map((x, idx) => {
                          if (idx !== i) return x; const cb = x as CompareBlock;
                          const rows = arr.length; const cols = cb.options.length;
                          const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (__, c) => (cb.cells[r]?.[c] ?? '')));
                          return { ...cb, criteria: arr, cells } as Block;
                        }));
                      }} />
                    </div>
                    <div className="overflow-auto">
                      <table className="min-w-full text-[11px] border">
                        <thead>
                          <tr>
                            <th className="border px-2 py-1 text-left">기준/옵션</th>
                            {(b as CompareBlock).options.map((op, c) => (
                              <th key={c} className="border px-2 py-1 text-left">{op}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(b as CompareBlock).criteria.map((cr, r) => (
                            <tr key={r}>
                              <td className="border px-2 py-1 font-medium">{cr}</td>
                              {(b as CompareBlock).options.map((_, c) => (
                                <td key={c} className="border p-0">
                                  <textarea className="w-full h-16 text-[11px] p-1 outline-none" value={(b as CompareBlock).cells[r]?.[c] ?? ''} onChange={(e) => {
                                    const v = e.target.value; setBlocks((prev) => prev.map((x, idx) => {
                                      if (idx !== i) return x; const cb = x as CompareBlock; const cells = cb.cells.map((row) => row.slice()); cells[r][c] = v; return { ...cb, cells } as Block;
                                    }));
                                  }} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="text-xs text-gray-600 mb-1">라벨</div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] flex items-center gap-1">신뢰도
            <select className="text-xs border rounded px-2 py-1" value={meta.reliability || ''} onChange={(e) => setMeta((m) => ({ ...m, reliability: e.target.value || undefined }))}>
              <option value=""></option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="text-[11px] flex items-center gap-1">출처
            <select className="text-xs border rounded px-2 py-1" value={meta.source || ''} onChange={(e) => setMeta((m) => ({ ...m, source: e.target.value || undefined }))}>
              <option value=""></option>
              <option value="original">original</option>
              <option value="derived">derived</option>
              <option value="ai">ai</option>
            </select>
          </label>
          <label className="text-[11px] flex items-center gap-1">최신성
            <select className="text-xs border rounded px-2 py-1" value={meta.freshness || ''} onChange={(e) => setMeta((m) => ({ ...m, freshness: e.target.value || undefined }))}>
              <option value=""></option>
              <option value="new">new</option>
              <option value="updated">updated</option>
              <option value="stale">stale</option>
            </select>
          </label>
        </div>
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
