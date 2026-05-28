"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as dagre from "dagre";
import { edgeStyleFor, EDGE_STROKE, EDGE_STROKE_EMPHASIS } from "@/lib/edgeStyle";

type Props = {
  qaId?: string;
  centerQaId?: string;
  centerChainIds?: string[];
  currentUserEmail?: string | null;
  refreshKey?: number;
  onSetQaId?: (id: string) => void;
  onSaved?: () => void;
  aiQuestion?: string;
  aiAnswer?: string;
};

type MapNode = { id: string; question: string; hasAnswer: boolean; summary?: string; answer?: string; helpful?: number; unhelpful?: number; myVote?: 1 | -1 | 0 };
type MapEdge = { sourceId: string; targetId: string; type: string; weight?: number; synthetic?: boolean };

function QAGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
  onOpen,
  heightClass,
}: {
  nodes: MapNode[];
  edges: MapEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  heightClass?: string;
}) {
  const nodeW = 340;
  const nodeH = 118;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [scale, setScale] = useState<number>(1);
  const [tx, setTx] = useState<number>(0);
  const [ty, setTy] = useState<number>(0);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null);
  const autoKeyRef = useRef<string | null>(null);
  const isPointerDownRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const didDragRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const clickTol = 8;
  const graph = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 18, ranksep: 48 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) g.setNode(n.id, { width: nodeW, height: nodeH });
    for (const e of edges) g.setEdge(e.sourceId, e.targetId, { id: `${e.sourceId}|${e.targetId}|${e.type}` });
    dagre.layout(g);
    return g;
  }, [nodes, edges]);

  const G = graph.graph() as unknown as { width?: number; height?: number };
  const W = Math.max(720, Number(G.width || 0) || 720);
  const H = Math.max(360, Number(G.height || 0) || 360);
  const pos = new Map<string, { x: number; y: number; n: MapNode }>();
  for (const n of nodes) {
    const p = graph.node(n.id) as { x: number; y: number } | undefined;
    if (p) pos.set(n.id, { x: p.x, y: p.y, n });
  }

  useEffect(() => {
    const key = `${nodes.length}|${edges.length}|${W}|${H}`;
    if (autoKeyRef.current === key) return;
    autoKeyRef.current = key;
    const s = Math.min(2.8, Math.max(1, Math.max(W / 820, H / 460)));
    const cx = W / 2;
    const cy = H / 2;
    setScale(s);
    setTx(cx * (1 - s));
    setTy(cy * (1 - s));
  }, [nodes.length, edges.length, W, H]);

  // Monochrome edge color; emphasis stroke when hovered/selected.
  const markerId = "qa_arrow_mono";

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const my = ((e.clientY - rect.top) / rect.height) * H;
    const zoom = Math.exp(-e.deltaY * 0.0015);
    const newScale = Math.min(3, Math.max(0.3, scale * zoom));
    const sx = (mx - tx) / scale;
    const sy = (my - ty) / scale;
    setTx(mx - sx * newScale);
    setTy(my - sy * newScale);
    setScale(newScale);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    isPointerDownRef.current = true;
    didDragRef.current = false;
    suppressClickRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragRef.current = { x: e.clientX, y: e.clientY };
    try { (e.currentTarget as unknown as Element & { setPointerCapture: (id: number) => void }).setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isPointerDownRef.current) return;
    const start = dragStartRef.current;
    if (start && !didDragRef.current) {
      const dx0 = e.clientX - start.x;
      const dy0 = e.clientY - start.y;
      if (Math.hypot(dx0, dy0) < clickTol) return;
      didDragRef.current = true;
      suppressClickRef.current = true;
      setDragging(true);
    }
    if (!didDragRef.current) return;
    const prev = dragRef.current;
    const dx = e.clientX - (prev?.x ?? e.clientX);
    const dy = e.clientY - (prev?.y ?? e.clientY);
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const unitX = W / rect.width;
    const unitY = H / rect.height;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setTx((p) => p + (dx * unitX) / scale);
    setTy((p) => p + (dy * unitY) / scale);
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const shouldResetSuppress = suppressClickRef.current;
    isPointerDownRef.current = false;
    didDragRef.current = false;
    dragStartRef.current = null;
    dragRef.current = null;
    setDragging(false);
    try { (e.currentTarget as unknown as Element & { releasePointerCapture: (id: number) => void }).releasePointerCapture(e.pointerId); } catch {}
    if (shouldResetSuppress) {
      setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  };

  const titleLines = (q: string) => {
    const t = String(q || "").replace(/\s+/g, " ").trim();
    const max = 72;
    const tt = t.length <= max ? t : t.slice(0, Math.max(0, max - 1)) + "…";
    const lineLen = 30;
    const l1 = tt.slice(0, lineLen);
    const rest = tt.slice(lineLen);
    if (!rest) return [l1];
    const l2 = rest.length <= lineLen ? rest : rest.slice(0, Math.max(0, lineLen - 1)) + "…";
    return [l1, l2];
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className={`w-full ${heightClass || "h-72 md:h-[420px]"} ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{ touchAction: "none" }}
    >
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_STROKE} />
        </marker>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="transparent" />
      <g transform={`translate(${tx},${ty}) scale(${scale})`}>
        {edges
          .filter((e) => pos.has(e.sourceId) && pos.has(e.targetId))
          .map((e) => {
            const s = pos.get(e.sourceId)!;
            const t = pos.get(e.targetId)!;
            const style = edgeStyleFor(e.type);
            const eid = `${e.sourceId}|${e.targetId}|${e.type}`;
            const focus = hoverNodeId || selectedId;
            const isConnected = !!focus && (e.sourceId === focus || e.targetId === focus);
            const isHover = hoverEdgeId === eid;
            const dim = (focus || hoverEdgeId) && !(isHover || isConnected);
            const opacity = dim ? 0.30 : 0.9;
            const stroke = isHover || isConnected ? EDGE_STROKE_EMPHASIS : EDGE_STROKE;
            const strokeW = isHover ? style.width + 1.6 : isConnected ? style.width + 1.0 : style.width + 0.4;
            const dasharray = e.synthetic ? "4 3" : style.dasharray;
            const midx = (s.x + t.x) / 2;
            const midy = (s.y + t.y) / 2;
            return (
              <g
                key={eid}
                opacity={opacity}
                onMouseEnter={() => setHoverEdgeId(eid)}
                onMouseLeave={() => setHoverEdgeId(null)}
              >
                <line
                  x1={s.x + nodeW / 2}
                  y1={s.y}
                  x2={t.x - nodeW / 2}
                  y2={t.y}
                  stroke={stroke}
                  strokeWidth={strokeW}
                  strokeLinecap="round"
                  strokeDasharray={dasharray}
                  markerEnd={`url(#${markerId})`}
                />
                {(isHover || isConnected) && (
                  <text x={midx} y={midy - 8} fontSize={11} fontWeight={600} textAnchor="middle" fill={stroke} stroke="var(--bg-elevated, #ffffff)" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">{String(e.type || "")}</text>
                )}
              </g>
            );
          })}
        {Array.from(pos.entries()).map(([id, p]) => {
          const isSel = selectedId === id;
          const isHover = hoverNodeId === id;
          const fill = p.n.hasAnswer ? "var(--bg-elevated, #ffffff)" : "var(--bg-secondary, #f3f4f6)";
          const stroke = isSel ? "var(--accent, #7c6cff)" : isHover ? "var(--text-normal, #0f172a)" : "var(--border-strong, #4b5563)";
          const strokeW = isSel ? 2.4 : isHover ? 2.0 : 1.4;
          const x0 = p.x - nodeW / 2 + 12;
          const lines = titleLines(p.n.question);
          const sub = `${p.n.hasAnswer ? "A" : "No A"} · ${Number(p.n.helpful || 0)}↑ ${Number(p.n.unhelpful || 0)}↓`;
          return (
            <g
              key={id}
              onMouseEnter={() => setHoverNodeId(id)}
              onMouseLeave={() => setHoverNodeId(null)}
              onClick={() => {
                if (suppressClickRef.current) return;
                onSelect(id);
              }}
              onDoubleClick={() => {
                if (suppressClickRef.current) return;
                onOpen(id);
              }}
              style={{ cursor: "pointer" }}
            >
              <rect x={p.x - nodeW / 2} y={p.y - nodeH / 2} width={nodeW} height={nodeH} rx={8} ry={8} fill={fill} stroke={stroke} strokeWidth={strokeW} style={{ filter: "drop-shadow(0px 1px 1.5px rgba(0,0,0,0.12))" }} />
              <text x={x0} y={p.y - 26} fontSize={13} fontWeight={600} fill="var(--text-normal)">
                {lines.map((ln, i) => (
                  <tspan key={i} x={x0} dy={i === 0 ? 0 : 16}>{ln}</tspan>
                ))}
              </text>
              <text x={x0} y={p.y + 34} fontSize={11} fontWeight={500} fill="var(--text-muted)">{sub}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default function RightWriter({ qaId, centerQaId, centerChainIds, currentUserEmail, refreshKey, onSetQaId, onSaved, aiQuestion, aiAnswer }: Props) {
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
  const [view, setView] = useState<"graph" | "doc">("graph");
  const [graphFullscreen, setGraphFullscreen] = useState(false);
  const focusQaId = useMemo(() => {
    if (qaId) return qaId;
    if (centerQaId) return centerQaId;
    const first = Array.isArray(centerChainIds) && centerChainIds.length ? centerChainIds[0] : null;
    return first || undefined;
  }, [qaId, centerQaId, JSON.stringify(centerChainIds || [])]);
  const [gLoading, setGLoading] = useState(false);
  const [gError, setGError] = useState<string | null>(null);
  const [gNodes, setGNodes] = useState<MapNode[]>([]);
  const [gEdges, setGEdges] = useState<MapEdge[]>([]);
  const [gSelectedId, setGSelectedId] = useState<string | null>(null);
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
    let active = true;
    (async () => {
      try {
        if (!focusQaId) { if (active) { setGNodes([]); setGEdges([]); } return; }
        setGLoading(true);
        setGError(null);
        const r = await fetch(`/api/qa/map?qaId=${encodeURIComponent(focusQaId)}&full=1`, { cache: "no-store" });
        const j = await r.json().catch(() => ({ nodes: [], edges: [] }));
        if (!active) return;
        const nodesArr = Array.isArray(j?.nodes) ? (j.nodes as MapNode[]) : [];
        const edgesArr = Array.isArray(j?.edges) ? (j.edges as MapEdge[]) : [];
        setGNodes(nodesArr);
        setGEdges(edgesArr);
        if (nodesArr.some((n) => n.id === focusQaId)) setGSelectedId(focusQaId);
      } catch (e: unknown) {
        if (!active) return;
        setGError(e instanceof Error ? e.message : "Failed to load graph");
        setGNodes([]);
        setGEdges([]);
      } finally {
        if (active) setGLoading(false);
      }
    })();
    return () => { active = false; };
  }, [focusQaId, refreshKey]);

  useEffect(() => {
    if (!graphFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [graphFullscreen]);

  useEffect(() => {
    if (!graphFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setGraphFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [graphFullscreen]);

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
      {error && <div className="text-xs text-red-600">{error}</div>}
      {/* blocks hidden */}
      {/* labels hidden */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button className={`text-[11px] px-2 py-1 rounded border ${view === 'graph' ? 'bg-gray-100' : ''}`} onClick={() => setView('graph')}>Graph</button>
          <button className={`text-[11px] px-2 py-1 rounded border ${view === 'doc' ? 'bg-gray-100' : ''}`} onClick={() => setView('doc')}>Doc</button>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-gray-600">{focusQaId ? `Focus: ${focusQaId}` : "대상을 선택하세요."}</div>
          {view === 'graph' && (
            <button className="text-[11px] px-2 py-1 rounded border disabled:opacity-50" disabled={gLoading || !!gError || gNodes.length === 0} onClick={() => setGraphFullscreen(true)}>전체화면</button>
          )}
        </div>
      </div>

      {view === "graph" ? (
        <div className="flex flex-col gap-2">
          {gLoading && <div className="text-xs text-gray-500">불러오는 중...</div>}
          {gError && <div className="text-xs text-red-600">{gError}</div>}
          {!gLoading && !gError && gNodes.length > 0 && (
            <QAGraph
              nodes={gNodes}
              edges={gEdges}
              selectedId={gSelectedId}
              onSelect={(id) => setGSelectedId(id)}
              onOpen={(id) => { onSetQaId?.(id); setView('doc'); }}
            />
          )}
          {!gLoading && !gError && gNodes.length === 0 && (
            <div className="text-xs text-gray-500">그래프가 없습니다.</div>
          )}
          {gSelectedId && (
            <div className="text-[11px] text-gray-700 flex items-center justify-between gap-2">
              <div className="truncate">Selected: {gSelectedId}</div>
              <button className="text-[11px] px-2 py-1 rounded border" onClick={() => { onSetQaId?.(gSelectedId); setView('doc'); }}>Edit</button>
            </div>
          )}
        </div>
      ) : (
        <>
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
        </>
      )}

      {graphFullscreen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" onClick={(e) => { if (e.target === e.currentTarget) setGraphFullscreen(false); }}>
          <div className="bg-white dark:bg-gray-900 rounded shadow-lg p-3 w-[1100px] max-w-[98vw] max-h-[92vh] overflow-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold">Graph</div>
              <button className="text-xs px-2 py-1 rounded border" onClick={() => setGraphFullscreen(false)}>닫기</button>
            </div>
            {gLoading && <div className="text-xs text-gray-500">불러오는 중...</div>}
            {gError && <div className="text-xs text-red-600">{gError}</div>}
            {!gLoading && !gError && gNodes.length > 0 && (
              <QAGraph
                nodes={gNodes}
                edges={gEdges}
                selectedId={gSelectedId}
                onSelect={(id) => setGSelectedId(id)}
                onOpen={(id) => { onSetQaId?.(id); setView('doc'); setGraphFullscreen(false); }}
                heightClass="h-[80vh]"
              />
            )}
            {!gLoading && !gError && gNodes.length === 0 && (
              <div className="text-xs text-gray-500">그래프가 없습니다.</div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white text-xs px-3 py-2 rounded shadow">{toast}</div>
      )}
    </div>
  );
}
