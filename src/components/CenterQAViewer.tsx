"use client";

import { useEffect, useState } from "react";
import type { LlmPatch, NodeType, EdgeType } from "@/types/graph";

type Props = {
  qaId?: string;
  question?: string;
  aiAnswer?: string;
  aiProvider?: "openai" | "anthropic";
  aiModel?: string;
  aiFallbackUsed?: boolean;
  aiResponseId?: string;
  provider?: "openai" | "anthropic";
  detail?: "short" | "normal" | "long";
  lockContext?: boolean;
  onToggleLock?: (v: boolean) => void;
  onSetPrevRespId?: (rid: string | null) => void;
  onOpenThread?: () => void;
  onShared?: (id: string) => void;
  onPinned?: (id: string) => void;
  refreshKey?: number;
  onSelectQA?: (id: string) => void;
  currentUserEmail?: string;
  onKeywordClick?: (kw: string) => void;
  onKeywordSearch?: (opts: { keywords?: string[]; phrases?: string[]; mode?: "any" | "all" }) => void;
  onSetSource?: (id: string) => void;
  onSetTarget?: (id: string) => void;
  onSetCard?: (id: string) => void;
  onGraphChanged?: () => void;
};

export default function CenterQAViewer({ qaId, question, aiAnswer, aiProvider, aiModel, aiFallbackUsed, aiResponseId, provider, detail, lockContext, onToggleLock, onSetPrevRespId, onOpenThread, onShared, onPinned, refreshKey, onSelectQA, currentUserEmail, onKeywordClick, onKeywordSearch, onSetSource, onSetTarget, onSetCard, onGraphChanged }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any | null>(null);
  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [newSummary, setNewSummary] = useState("");
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [notes, setNotes] = useState<Array<{ id: string; userId?: string; content: string; createdAt: string }>>([]);
  const [mapNodes, setMapNodes] = useState<Array<{ id: string; question: string; summary?: string; answer?: string }>>([]);
  const [mapEdges, setMapEdges] = useState<Array<{ sourceId: string; targetId: string; type: string }>>([]);
  const [publishing, setPublishing] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [phrases, setPhrases] = useState<string[]>([]);
  const [kwLoading, setKwLoading] = useState(false);
  const [selectMode, setSelectMode] = useState<"any" | "all" | null>(null);
  const [selWords, setSelWords] = useState<string[]>([]);
  const [selPhrases, setSelPhrases] = useState<string[]>([]);
  const [fuInput, setFuInput] = useState("");
  const [fuLoading, setFuLoading] = useState(false);
  const [fuItems, setFuItems] = useState<Array<{ q: string; a: string; respId: string | null; savedId?: string }>>([]);
  const [relType, setRelType] = useState<string>("precedes");
  const [relDir, setRelDir] = useState<"current_to_new" | "new_to_current">("current_to_new");
  const [pairBusy, setPairBusy] = useState(false);
  const [fuMap, setFuMap] = useState<Record<string, { input: string; loading: boolean; items: Array<{ q: string; a: string; respId: string | null; savedId?: string }> }>>({});

  function startSelect(mode: "any" | "all") {
    setSelectMode(mode);
    setSelWords([]);
    setSelPhrases([]);
  }

  async function savePairAndRelAtFor(baseQaId: string, index: number) {
    const entry = fuMap[baseQaId];
    if (!entry) return;
    const i = index;
    if (i < 0 || i >= entry.items.length) return;
    const nextQ = entry.items[i].q.trim();
    const nextA = entry.items[i].a.trim();
    if (!nextQ || !nextA) return;
    try {
      setPairBusy(true);
      // Base is an existing QA (connected item)
      let baseId: string | undefined = baseQaId;
      let baseQ = "";
      let baseA = "";
      let baseRid: string | undefined = undefined;
      if (i === 0) {
        const base = mapNodes.find((n) => n.id === baseQaId);
        baseQ = String(base?.question || "");
        baseA = String(base?.answer || base?.summary || "");
      } else {
        const prev = entry.items[i - 1];
        baseQ = prev.q;
        baseA = prev.a;
        baseRid = prev.respId || undefined;
        baseId = entry.items[i - 1].savedId;
      }
      // Ensure previous follow-up is saved if needed
      if (!baseId) {
        const r1 = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: baseQ, answer: baseA, summary: undefined, responseId: baseRid || undefined, published: false }) });
        if (!r1.ok) throw new Error("Base save failed");
        const j1 = await r1.json();
        baseId = String(j1?.id || "");
        if (!baseId) throw new Error("No baseId");
        setFuMap((m) => {
          const prev = m[baseQaId]!;
          const arr = [...prev.items];
          arr[i - 1] = { ...arr[i - 1], savedId: baseId! };
          return { ...m, [baseQaId]: { ...prev, items: arr } };
        });
      }
      // Save current follow-up item if not yet saved
      let newId: string | undefined = entry.items[i].savedId;
      if (!newId) {
        const r2 = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: nextQ, answer: nextA, summary: undefined, responseId: entry.items[i].respId || undefined, parentId: undefined, published: false }) });
        if (!r2.ok) throw new Error("Follow-up save failed");
        const j2 = await r2.json();
        newId = String(j2?.id || "");
        if (!newId) throw new Error("No newId");
        setFuMap((m) => {
          const prev = m[baseQaId]!;
          const arr = [...prev.items];
          arr[i] = { ...arr[i], savedId: newId! };
          return { ...m, [baseQaId]: { ...prev, items: arr } };
        });
      }
      const sourceId = relDir === "current_to_new" ? baseId! : newId!;
      const targetId = relDir === "current_to_new" ? newId! : baseId!;
      const r3 = await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, targetId, type: relType, weight: 1 }) });
      if (!r3.ok) throw new Error("Relation failed");
      onGraphChanged?.();
      if (relDir === "current_to_new") { onSetSource?.(baseId!); onSetTarget?.(newId!); }
      else { onSetSource?.(newId!); onSetTarget?.(baseId!); }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setPairBusy(false); }
  }

  async function askFollowUpFor(baseQaId: string) {
    const entry = fuMap[baseQaId] || { input: "", loading: false, items: [] };
    const q = (entry.input || "").trim();
    if (!q) return;
    try {
      setFuMap((m) => ({ ...m, [baseQaId]: { ...entry, loading: true } }));
      const ctxIds: string[] = [baseQaId];
      const lastRid = entry.items.length > 0 ? entry.items[entry.items.length - 1].respId : undefined;
      const prevRid = lockContext ? (lastRid || undefined) : undefined;
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: q, history: [], provider, detail, previousResponseId: prevRid, contextIds: ctxIds }) });
      if (!res.ok) throw new Error("AI call failed");
      const j = await res.json();
      const a = String(j?.answer || "");
      const rid = j?.responseId ? String(j.responseId) : null;
      setFuMap((m) => {
        const prev = m[baseQaId] || { input: "", loading: false, items: [] };
        return { ...m, [baseQaId]: { input: "", loading: false, items: [...prev.items, { q, a, respId: rid }] } };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setFuMap((m) => ({ ...m, [baseQaId]: { ...(m[baseQaId] || { input: "", items: [] } as any), loading: false } }));
    }
  }

  async function askFollowUp() {
    const q = fuInput.trim();
    if (!q) return;
    try {
      setFuLoading(true);
      const ctxIds: string[] = qaId ? [qaId] : [];
      const lastRid = fuItems.length > 0 ? fuItems[fuItems.length - 1].respId : undefined;
      const baseRid = qaId ? (data?.lastResponseId as string | undefined) : aiResponseId;
      const prevRid = lockContext ? (lastRid || baseRid) : undefined;
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: q, history: [], provider, detail, previousResponseId: prevRid, contextIds: ctxIds }) });
      if (!res.ok) throw new Error("AI call failed");
      const j = await res.json();
      const a = String(j?.answer || "");
      const rid = j?.responseId ? String(j.responseId) : null;
      setFuItems((prev) => [...prev, { q, a, respId: rid }]);
      setFuInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setFuLoading(false); }
  }

  async function savePairAndRelAt(index: number) {
    const i = index;
    if (i < 0 || i >= fuItems.length) return;
    const nextQ = fuItems[i].q.trim();
    const nextA = fuItems[i].a.trim();
    if (!nextQ || !nextA) return;
    try {
      setPairBusy(true);
      // Determine base
      let baseId: string | undefined = qaId as string | undefined;
      let baseQ = "";
      let baseA = "";
      let baseRid: string | undefined = undefined;
      if (i === 0) {
        if (qaId) {
          baseQ = String(data?.question || "");
          baseA = String(data?.answer || data?.summary || "");
        } else {
          baseQ = String(question || "");
          baseA = String(aiAnswer || "");
          baseRid = aiResponseId || undefined;
        }
      } else {
        const prev = fuItems[i - 1];
        baseQ = prev.q;
        baseA = prev.a;
        baseRid = prev.respId || undefined;
        baseId = fuItems[i - 1].savedId;
      }
      // Ensure base saved if needed
      if (!baseId) {
        const ok = typeof window !== "undefined" ? window.confirm(i === 0 ? "현재 중앙 AI 답변을 초안으로 저장하고 관계를 생성할까요?" : "이전 후속 질문도 초안으로 저장하고 관계를 생성할까요?") : true;
        if (!ok) { setPairBusy(false); return; }
        const r1 = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: baseQ, answer: baseA, summary: undefined, responseId: baseRid || undefined, published: false }) });
        if (!r1.ok) throw new Error("Base save failed");
        const j1 = await r1.json();
        baseId = String(j1?.id || "");
        if (!baseId) throw new Error("No baseId");
        if (i === 0) {
          onShared?.(baseId);
        } else {
          // persist savedId for previous item
          setFuItems((prevArr) => {
            const arr = [...prevArr];
            arr[i - 1] = { ...arr[i - 1], savedId: baseId! };
            return arr;
          });
        }
      }
      // Save current follow-up item if not yet saved
      let newId: string | undefined = fuItems[i].savedId;
      if (!newId) {
        const r2 = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: nextQ, answer: nextA, summary: undefined, responseId: fuItems[i].respId || undefined, parentId: undefined, published: false }) });
        if (!r2.ok) throw new Error("Follow-up save failed");
        const j2 = await r2.json();
        newId = String(j2?.id || "");
        if (!newId) throw new Error("No newId");
        setFuItems((prevArr) => {
          const arr = [...prevArr];
          arr[i] = { ...arr[i], savedId: newId! };
          return arr;
        });
      }
      const sourceId = relDir === "current_to_new" ? baseId! : newId!;
      const targetId = relDir === "current_to_new" ? newId! : baseId!;
      const r3 = await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, targetId, type: relType, weight: 1 }) });
      if (!r3.ok) throw new Error("Relation failed");
      onGraphChanged?.();
      if (relDir === "current_to_new") { onSetSource?.(baseId!); onSetTarget?.(newId); }
      else { onSetSource?.(newId); onSetTarget?.(baseId!); }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setPairBusy(false); }
  }
  function cancelSelect() {
    setSelectMode(null);
    setSelWords([]);
    setSelPhrases([]);
  }
  function doSearch() {
    if (!selectMode) return;
    onKeywordSearch?.({
      keywords: selWords.length ? selWords : undefined,
      phrases: selPhrases.length ? selPhrases : undefined,
      mode: selectMode,
    });
  }
  function toggleSelWord(w: string) {
    if (!selectMode) { onKeywordClick?.(w); return; }
    setSelWords((prev) => (prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w]));
  }
  function toggleSelPhrase(p: string) {
    if (!selectMode) { onKeywordSearch?.({ phrases: [p], mode: "any" }); return; }
    setSelPhrases((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

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

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (qaId && data) {
          setKwLoading(true);
          // Use cached QA keywords (populate on first request)
          const r = await fetch("/api/qa/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, max: 8 }) });
          const j = await r.json().catch(() => ({ results: {}, phrases: {} }));
          const arr: string[] = Array.isArray(j?.results?.[qaId]) ? j.results[qaId] : [];
          const ph: string[] = Array.isArray(j?.phrases?.[qaId]) ? j.phrases[qaId] : [];
          if (active) { setKeywords(arr); setPhrases(ph); }
        } else if (!qaId && aiAnswer) {
          const text = String(aiAnswer || "");
          if (!text.trim()) { if (active) setKeywords([]); return; }
          setKwLoading(true);
          const r = await fetch("/api/ai/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, max: 8 }) });
          const j = await r.json().catch(() => ({ keywords: [], phrases: [] }));
          if (active) {
            setKeywords(Array.isArray(j?.keywords) ? j.keywords : []);
            setPhrases(Array.isArray(j?.phrases) ? j.phrases : []);
          }
        } else {
          if (active) { setKeywords([]); setPhrases([]); }
        }
      } catch {
        if (active) setKeywords([]);
      } finally {
        if (active) setKwLoading(false);
      }
    })();
    return () => { active = false; };
  }, [qaId, data?.summary, data?.answer, data?.question, aiAnswer]);

  useEffect(() => {
    setFuItems([]);
    setFuInput("");
    setFuMap({});
  }, [qaId, question, aiAnswer]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!qaId) { if (active) { setMapNodes([]); setMapEdges([]); } return; }
      try {
        const r = await fetch(`/api/qa/map?qaId=${encodeURIComponent(qaId)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({ nodes: [], edges: [] }));
        if (active) {
          setMapNodes(Array.isArray(j?.nodes) ? j.nodes : []);
          setMapEdges(Array.isArray(j?.edges) ? j.edges : []);
        }
      } catch {
        if (active) { setMapNodes([]); setMapEdges([]); }
      }
    })();
    return () => { active = false; };
  }, [qaId, refreshKey]);

  async function saveNote() {
    const content = note.trim();
    if (!qaId || !content) return;
    try {
      setSavingNote(true);
      const res = await fetch("/api/qa/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, content }) });
      if (!res.ok) throw new Error("Note failed");
      setNote("");
      // refresh notes
      const r = await fetch(`/api/qa/note?qaId=${encodeURIComponent(qaId)}`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        setNotes(Array.isArray(j?.notes) ? j.notes : []);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSavingNote(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      if (!qaId) { if (active) setNotes([]); return; }
      try {
        const r = await fetch(`/api/qa/note?qaId=${encodeURIComponent(qaId)}`, { cache: "no-store" });
        if (!r.ok) throw new Error("Notes failed");
        const j = await r.json();
        if (active) setNotes(Array.isArray(j?.notes) ? j.notes : []);
      } catch {
        if (active) setNotes([]);
      }
    })();
    return () => { active = false; };
  }, [qaId]);

  useEffect(() => {
    if (!lockContext) { onSetPrevRespId?.(null); return; }
    if (qaId && data?.lastResponseId) { onSetPrevRespId?.(String(data.lastResponseId)); return; }
    if (!qaId && aiResponseId) { onSetPrevRespId?.(String(aiResponseId)); return; }
  }, [lockContext, qaId, data?.lastResponseId, aiResponseId]);

  async function vote(v: 1 | -1) {
    if (!qaId) return;
    try {
      setVoteBusy(true);
      const res = await fetch("/api/qa/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, vote: v }) });
      if (!res.ok) throw new Error("Vote failed");
      // refresh counts
      const r = await fetch(`/api/qa/${encodeURIComponent(qaId)}`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setVoteBusy(false);
    }
  }

  async function togglePublish(next: boolean) {
    if (!qaId) return;
    try {
      setPublishing(true);
      const res = await fetch("/api/qa/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, published: next }) });
      if (!res.ok) throw new Error("Publish failed");
      const r = await fetch(`/api/qa/${encodeURIComponent(qaId)}`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setPublishing(false);
    }
  }

  async function saveSummary() {
    if (!qaId) return;
    const s = editSummary.trim();
    if (!s) return;
    try {
      setSaving(true);
      const res = await fetch("/api/qa/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qaId, summary: s }) });
      if (!res.ok) throw new Error("Update failed");
      const r = await fetch(`/api/qa/${encodeURIComponent(qaId)}`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
      setEditing(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function shareNew() {
    const q = (question || "").trim();
    const a = (aiAnswer || "").trim();
    if (!q || !a) return;
    try {
      setSaving(true);
      const res = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, answer: a, summary: newSummary.trim() || undefined, responseId: aiResponseId || undefined }) });
      if (!res.ok) throw new Error("Share failed");
      const j = await res.json();
      const id = String(j?.id || "");
      if (id) {
        onShared?.(id);
        onPinned?.(id);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function shareAnd(mode: "source" | "target" | "card") {
    const q = (question || "").trim();
    const a = (aiAnswer || "").trim();
    if (!q || !a) return;
    try {
      setSaving(true);
      const res = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, answer: a, summary: newSummary.trim() || undefined, responseId: aiResponseId || undefined }) });
      if (!res.ok) throw new Error("Share failed");
      const j = await res.json();
      const id = String(j?.id || "");
      if (id) {
        if (mode === "source") onSetSource?.(id);
        else if (mode === "target") onSetTarget?.(id);
        else { onSetCard?.(id); onPinned?.(id); }
        onSelectQA?.(id);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

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
    const rawPatch = (data as any)?.patch;
    let patchAny: any = rawPatch;
    try { if (typeof rawPatch === "string") patchAny = JSON.parse(rawPatch as string); } catch {}
    const hasLlmPatch = !!(patchAny && Array.isArray(patchAny?.ops));
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Q: {data.question}</div>
        {/* Top action bar removed per UX change */}
        <div className="flex items-center gap-2 text-[11px] text-gray-600">
          <span className={`px-2 py-0.5 rounded-full border ${data.published !== false ? 'bg-green-50 border-green-200 text-green-700' : 'bg-yellow-50 border-yellow-200 text-yellow-700'}`}>{data.published !== false ? 'Published' : 'Draft'}</span>
          {data.createdBy && <span>by {data.createdBy}</span>}
          {data.lastResponseId && <span className="truncate max-w-[50%]" title={data.lastResponseId}>RID: {data.lastResponseId}</span>}
          <label className="ml-auto inline-flex items-center gap-1">
            <input type="checkbox" checked={!!lockContext} onChange={(e) => { onToggleLock?.(e.target.checked); const rid = String(data?.lastResponseId || ""); if (e.target.checked) onSetPrevRespId?.(rid || null); else onSetPrevRespId?.(null); }} /> 이 RID로 맥락 고정
          </label>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white" onClick={() => { if (qaId) onSetCard?.(qaId); }}>가이드에 추가</button>
          <button className="text-xs px-2 py-1 rounded border" onClick={() => setEditing((v) => !v)}>{editing ? "편집 취소" : "개선하기"}</button>
          <button className="text-xs px-2 py-1 rounded border" onClick={() => { if (!qaId) return; try { const url = location.origin + "/?qa=" + encodeURIComponent(qaId); navigator.clipboard?.writeText(url); } catch {} }}>공유하기</button>
        </div>
        {data.answer && <div className="text-sm whitespace-pre-wrap">A: {data.answer}</div>}
        {(() => { const s = String(data.summary || "").trim(); const a = String(data.answer || "").trim(); const distinct = s && s !== a; return (!editing && distinct) ? (<div className="text-xs text-gray-700 whitespace-pre-wrap">Summary: {data.summary}</div>) : null; })()}
        <div className="mt-3 rounded border p-2 bg-white/60 dark:bg-gray-900/40">
          <div className="text-xs text-gray-700 mb-1">후속 질문</div>
          {fuItems.length > 0 && (
            <div className="space-y-2">
              {fuItems.map((it, i) => (
                <div key={`fu-${i}`} className="rounded border p-2 bg-white/70 dark:bg-gray-900/50">
                  <div className="text-[12px] text-gray-800">Q: {it.q}</div>
                  <div className="text-[12px] text-gray-600 mt-1">AI: {it.a}</div>
                  <div className="mt-1 text-[10px] text-gray-500">{it.respId ? `RID: ${it.respId}` : ''}</div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
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
                    <select className="text-xs border rounded px-2 py-1" value={relDir} onChange={(e) => setRelDir(e.target.value as any)}>
                      <option value="current_to_new">현재 → 후속</option>
                      <option value="new_to_current">후속 → 현재</option>
                    </select>
                    <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={pairBusy} onClick={() => void savePairAndRelAt(i)}>{pairBusy ? "저장 중…" : "두 Q&A 저장 및 관계 생성"}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <input className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" placeholder="이 답변을 기반으로 이어서 물어보기" value={fuInput} onChange={(e) => setFuInput(e.target.value)} />
            <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={fuLoading || !fuInput.trim()} onClick={() => void askFollowUp()}>{fuLoading ? "요청 중…" : "답변 받기"}</button>
          </div>
        </div>
        <div className="mt-2">
          {kwLoading ? (
            <div className="text-[11px] text-gray-600">추출 중…</div>
          ) : ((phrases.length + keywords.length) > 0 ? (
            <div className="flex flex-wrap gap-1">
              {phrases.map((p, i) => (
                <button key={`ph-chip-${i}`} className="text-[11px] px-2 py-0.5 rounded-full border hover:bg-blue-50" onClick={() => toggleSelPhrase(p)}>{p}</button>
              ))}
              {keywords.map((k, i) => (
                <button key={`kw-chip-${i}`} className="text-[11px] px-2 py-0.5 rounded-full border hover:bg-blue-50" onClick={() => toggleSelWord(k)}>{k}</button>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-gray-600">없음</div>
          ))}
        </div>
        {editing && (
          <>
            <textarea className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" rows={4} value={editSummary} onChange={(e) => setEditSummary(e.target.value)} />
            <div className="mt-1 flex items-center gap-2">
              <button className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50" disabled={saving || !editSummary.trim()} onClick={() => void saveSummary()}>{saving ? "Saving..." : "변경 저장"}</button>
              <button className="text-xs px-2 py-1 rounded border" onClick={() => setEditing(false)}>취소</button>
            </div>
          </>
        )}
        <div className="flex items-center gap-2 mt-2">
          <button className="text-xs px-2 py-1 rounded border" disabled={!qaId} onClick={() => qaId && onSetSource?.(qaId)}>Set Source</button>
          <button className="text-xs px-2 py-1 rounded border" disabled={!qaId} onClick={() => qaId && onSetTarget?.(qaId)}>Set Target</button>
          <button className="text-xs px-2 py-1 rounded border" disabled={!qaId} onClick={() => qaId && onSetCard?.(qaId)}>Set Card</button>
        </div>
        <div className="mt-2">
          <div className="text-xs text-gray-600 mb-1">노트</div>
          <textarea
            className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60"
            rows={3}
            placeholder="참고/근거/메모"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            id="center-note"
            name="center-note"
          />
          <div className="mt-1">
            <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={!qaId || savingNote || !note.trim()} onClick={() => void saveNote()}>{savingNote ? "Saving..." : "저장"}</button>
          </div>
          {notes.length > 0 && (
            <ul className="mt-2 space-y-1">
              {notes.map((n) => (
                <li key={n.id} className="text-[11px] text-gray-700 whitespace-pre-wrap border rounded p-2">{n.content}</li>
              ))}
            </ul>
          )}
        </div>
        {hasLlmPatch && (
          <div className="mt-2">
            <PatchPreviewGraph patch={patchAny as LlmPatch} />
          </div>
        )}
        <div className="mt-3">
          <div className="text-xs text-gray-600 mb-1">연결(소스 → 현재)</div>
          {mapEdges.filter((e: any) => e.targetId === qaId).length > 0 ? (
            <ul className="space-y-2">
              {mapEdges
                .filter((e: any) => e.targetId === qaId)
                .map((e: any, idx: number) => {
                  const src = mapNodes.find((n) => n.id === e.sourceId);
                  if (!src) return null;
                  return (
                    <li key={`in-${idx}`} className="text-[12px] border rounded p-2">
                      <div className="min-w-0">
                        <div className="font-medium">{e.type} · Q: {src.question}</div>
                        {src.answer && <div className="mt-1 whitespace-pre-wrap">A: {src.answer}</div>}
                        {(() => { const s = String(src.summary || "").trim(); const a = String(src.answer || "").trim(); const distinct = s && s !== a; return distinct ? (<div className="text-[11px] text-gray-700 whitespace-pre-wrap">Summary: {src.summary}</div>) : null; })()}
                        {((fuMap[src.id]?.items?.length ?? 0) > 0) && (
                          <div className="mt-2 space-y-2">
                            {(fuMap[src.id]?.items || []).map((it, i2) => (
                              <div key={`in-fu-${src.id}-${i2}`} className="rounded border p-2 bg-white/70 dark:bg-gray-900/50">
                                <div className="text-[12px] text-gray-800">Q: {it.q}</div>
                                <div className="text-[12px] text-gray-600 mt-1">AI: {it.a}</div>
                                <div className="mt-1 text-[10px] text-gray-500">{it.respId ? `RID: ${it.respId}` : ''}</div>
                                <div className="mt-2 flex items-center gap-2 flex-wrap">
                                  <select className="text-xs border rounded px-2 py-1" value={relType} onChange={(ev) => setRelType(ev.target.value)}>
                                    <option value="precedes">precedes</option>
                                    <option value="prerequisite">prerequisite</option>
                                    <option value="narrows">narrows</option>
                                    <option value="elaborates">elaborates</option>
                                    <option value="clarifies">clarifies</option>
                                    <option value="supports">supports</option>
                                    <option value="refutes">refutes</option>
                                    <option value="alternative">alternative</option>
                                  </select>
                                  <select className="text-xs border rounded px-2 py-1" value={relDir} onChange={(ev) => setRelDir(ev.target.value as any)}>
                                    <option value="current_to_new">현재 → 후속</option>
                                    <option value="new_to_current">후속 → 현재</option>
                                  </select>
                                  <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={pairBusy} onClick={() => void savePairAndRelAtFor(src.id, i2)}>{pairBusy ? "저장 중…" : "두 Q&A 저장 및 관계 생성"}</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <input className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" placeholder="이 답변을 기반으로 이어서 물어보기" value={fuMap[src.id]?.input ?? ''} onChange={(ev) => setFuMap((m) => ({ ...m, [src.id]: { ...(m[src.id] || { input: '', loading: false, items: [] }), input: ev.target.value } }))} />
                          <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={!!(fuMap[src.id]?.loading) || !((fuMap[src.id]?.input ?? '').trim())} onClick={() => void askFollowUpFor(src.id)}>{fuMap[src.id]?.loading ? "요청 중…" : "답변 받기"}</button>
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <div className="text-[11px] text-gray-600">연결된 소스가 없습니다.</div>
          )}
        </div>
        <div className="mt-3">
          <div className="text-xs text-gray-600 mb-1">연결(현재 → 타겟)</div>
          {mapEdges.filter((e: any) => e.sourceId === qaId).length > 0 ? (
            <ul className="space-y-2">
              {mapEdges
                .filter((e: any) => e.sourceId === qaId)
                .map((e: any, idx: number) => {
                  const trg = mapNodes.find((n) => n.id === e.targetId);
                  if (!trg) return null;
                  return (
                    <li key={`out-${idx}`} className="text-[12px] border rounded p-2">
                      <div className="min-w-0">
                        <div className="font-medium">{e.type} · Q: {trg.question}</div>
                        {trg.answer && <div className="mt-1 whitespace-pre-wrap">A: {trg.answer}</div>}
                        {(() => { const s = String(trg.summary || "").trim(); const a = String(trg.answer || "").trim(); const distinct = s && s !== a; return distinct ? (<div className="text-[11px] text-gray-700 whitespace-pre-wrap">Summary: {trg.summary}</div>) : null; })()}
                        {((fuMap[trg.id]?.items?.length ?? 0) > 0) && (
                          <div className="mt-2 space-y-2">
                            {(fuMap[trg.id]?.items || []).map((it, i2) => (
                              <div key={`out-fu-${trg.id}-${i2}`} className="rounded border p-2 bg-white/70 dark:bg-gray-900/50">
                                <div className="text-[12px] text-gray-800">Q: {it.q}</div>
                                <div className="text-[12px] text-gray-600 mt-1">AI: {it.a}</div>
                                <div className="mt-1 text-[10px] text-gray-500">{it.respId ? `RID: ${it.respId}` : ''}</div>
                                <div className="mt-2 flex items-center gap-2 flex-wrap">
                                  <select className="text-xs border rounded px-2 py-1" value={relType} onChange={(ev) => setRelType(ev.target.value)}>
                                    <option value="precedes">precedes</option>
                                    <option value="prerequisite">prerequisite</option>
                                    <option value="narrows">narrows</option>
                                    <option value="elaborates">elaborates</option>
                                    <option value="clarifies">clarifies</option>
                                    <option value="supports">supports</option>
                                    <option value="refutes">refutes</option>
                                    <option value="alternative">alternative</option>
                                  </select>
                                  <select className="text-xs border rounded px-2 py-1" value={relDir} onChange={(ev) => setRelDir(ev.target.value as any)}>
                                    <option value="current_to_new">현재 → 후속</option>
                                    <option value="new_to_current">후속 → 현재</option>
                                  </select>
                                  <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={pairBusy} onClick={() => void savePairAndRelAtFor(trg.id, i2)}>{pairBusy ? "저장 중…" : "두 Q&A 저장 및 관계 생성"}</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <input className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" placeholder="이 답변을 기반으로 이어서 물어보기" value={fuMap[trg.id]?.input ?? ''} onChange={(ev) => setFuMap((m) => ({ ...m, [trg.id]: { ...(m[trg.id] || { input: '', loading: false, items: [] }), input: ev.target.value } }))} />
                          <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={!!(fuMap[trg.id]?.loading) || !((fuMap[trg.id]?.input ?? '').trim())} onClick={() => void askFollowUpFor(trg.id)}>{fuMap[trg.id]?.loading ? "요청 중…" : "답변 받기"}</button>
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <div className="text-[11px] text-gray-600">연결된 타겟이 없습니다.</div>
          )}
        </div>
      </div>
    );
  }

  if (question && aiAnswer) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Q: {question}</div>
        <div className="text-sm whitespace-pre-wrap">AI Answer: {aiAnswer}</div>
        {(aiProvider || aiModel || aiResponseId) && (
          <div className="text-[11px] text-gray-600">
            via {aiProvider === "anthropic" ? "Anthropic (Claude)" : aiProvider === "openai" ? "OpenAI" : "AI"}
            {aiModel ? ` · ${aiModel}` : ""}
            {aiFallbackUsed ? " · fallback" : ""}
            {aiResponseId ? ` · RID: ${aiResponseId}` : ""}
            <label className="ml-2 inline-flex items-center gap-1">
              <input type="checkbox" checked={!!lockContext} onChange={(e) => { onToggleLock?.(e.target.checked); const rid = String(aiResponseId || ""); if (e.target.checked) onSetPrevRespId?.(rid || null); else onSetPrevRespId?.(null); }} /> 이 RID로 맥락 고정
            </label>
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button
            className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
            disabled={saving}
            onClick={() => void shareAnd("card")}
          >{saving ? "Sharing..." : "가이드에 추가"}</button>
          <button
            className="text-xs px-2 py-1 rounded border"
            onClick={() => { try { document.getElementById("new-summary")?.focus(); } catch {} }}
          >개선하기</button>
          <button
            className="text-xs px-2 py-1 rounded border disabled:opacity-50"
            disabled={saving}
            onClick={() => void shareNew()}
          >{saving ? "Sharing..." : "공유하기"}</button>
        </div>
        <div className="text-xs text-gray-600">요약 또는 키워드를 확인하고 공유하면 지식 체계에 등록됩니다.</div>
        <div className="mt-2">
          {kwLoading ? (
            <div className="text-[11px] text-gray-600">추출 중…</div>
          ) : ((phrases.length + keywords.length) > 0 ? (
            <div className="flex flex-wrap gap-1">
              {phrases.map((p, i) => (
                <button key={`ph2-chip-${i}`} className="text-[11px] px-2 py-0.5 rounded-full border hover:bg-blue-50" onClick={() => toggleSelPhrase(p)}>{p}</button>
              ))}
              {keywords.map((k, i) => (
                <button key={`kw2-chip-${i}`} className="text-[11px] px-2 py-0.5 rounded-full border hover:bg-blue-50" onClick={() => toggleSelWord(k)}>{k}</button>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-gray-600">없음</div>
          ))}
        </div>
        <textarea id="new-summary" name="new-summary" className="w-full rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" rows={4} placeholder="핵심 요약을 작성하세요" value={newSummary} onChange={(e) => setNewSummary(e.target.value)} />
        <div className="flex items-center gap-2">
          <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={saving} onClick={() => void shareAnd("source")}>{saving ? "Sharing..." : "Set Source"}</button>
          <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={saving} onClick={() => void shareAnd("target")}>{saving ? "Sharing..." : "Set Target"}</button>
          <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={saving} onClick={() => void shareAnd("card")}>{saving ? "Sharing..." : "Set Card"}</button>
        </div>
        <div className="mt-3 rounded border p-2 bg-white/60 dark:bg-gray-900/40">
          <div className="text-xs text-gray-700 mb-1">후속 질문</div>
          {fuItems.length > 0 && (
            <div className="space-y-2">
              {fuItems.map((it, i) => (
                <div key={`fu2-${i}`} className="rounded border p-2 bg-white/70 dark:bg-gray-900/50">
                  <div className="text-[12px] text-gray-800">Q: {it.q}</div>
                  <div className="text-[12px] text-gray-600 mt-1">AI: {it.a}</div>
                  <div className="mt-1 text-[10px] text-gray-500">{it.respId ? `RID: ${it.respId}` : ''}</div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
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
                    <select className="text-xs border rounded px-2 py-1" value={relDir} onChange={(e) => setRelDir(e.target.value as any)}>
                      <option value="current_to_new">현재 → 후속</option>
                      <option value="new_to_current">후속 → 현재</option>
                    </select>
                    <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={pairBusy} onClick={() => void savePairAndRelAt(i)}>{pairBusy ? "저장 중…" : "두 Q&A 저장 및 관계 생성"}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <input className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" placeholder="이 답변을 기반으로 이어서 물어보기" value={fuInput} onChange={(e) => setFuInput(e.target.value)} />
            <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={fuLoading || !fuInput.trim()} onClick={() => void askFollowUp()}>{fuLoading ? "요청 중…" : "답변 받기"}</button>
          </div>
        </div>
      </div>
    );
  }

  if (question && !aiAnswer) {
    return <div className="text-xs text-gray-600">유사한 Q&A를 선택하거나 좌측에서 "지금 AI에게 묻기"를 눌러 답변을 받아보세요.</div>;
  }

  return <div className="text-xs text-gray-500">좌측에서 질문을 입력하세요.</div>;
}
