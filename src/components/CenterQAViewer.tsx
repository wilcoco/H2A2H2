"use client";

import { useEffect, useState } from "react";
import type { LlmPatch, NodeType, EdgeType } from "@/types/graph";

const REL_HEADS = {
  critical: {
    label: "비판/검증",
    defaultDir: "new_to_current" as const,
    types: [
      { type: "supports", label: "근거 제시" },
      { type: "refutes", label: "반박" },
      { type: "prerequisite", label: "전제 점검" },
    ],
  },
  drill: {
    label: "세부화",
    defaultDir: "current_to_new" as const,
    types: [
      { type: "elaborates", label: "상세화" },
      { type: "narrows", label: "범위 축소" },
      { type: "precedes", label: "다음 단계" },
    ],
  },
  abstraction: {
    label: "추상화",
    defaultDir: "new_to_current" as const,
    types: [
      { type: "clarifies", label: "요약/상위화" },
    ],
  },
  lateral: {
    label: "수평/대안",
    defaultDir: "current_to_new" as const,
    types: [
      { type: "alternative", label: "대안/비교/연관" },
    ],
  },
} as const;

type RelDir = "current_to_new" | "new_to_current";

function headOfType(t: string): keyof typeof REL_HEADS | null {
  for (const k of Object.keys(REL_HEADS) as (keyof typeof REL_HEADS)[]) {
    if (REL_HEADS[k].types.some((x) => x.type === t)) return k;
  }
  return null;
}

function defaultDirForType(t: string): RelDir {
  const h = headOfType(t);
  if (!h) return "current_to_new";
  return REL_HEADS[h].defaultDir;
}

function labelKoForType(t: string): string {
  for (const k of Object.keys(REL_HEADS) as (keyof typeof REL_HEADS)[]) {
    const f = REL_HEADS[k].types.find((x) => x.type === t);
    if (f) return f.label;
  }
  return t;
}

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
  selectedChainPath?: string[];
};

type QaData = { id?: string; question: string; answer?: string; summary?: string; patch?: unknown; published?: boolean; createdBy?: string; lastResponseId?: string };

export default function CenterQAViewer({ qaId, question, aiAnswer, aiProvider, aiModel, aiFallbackUsed, aiResponseId, provider, detail, lockContext, onToggleLock, onSetPrevRespId, onOpenThread, onShared, onPinned, refreshKey, onSelectQA, currentUserEmail, onKeywordClick, onKeywordSearch, onSetSource, onSetTarget, onSetCard, onGraphChanged, selectedChainPath }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<QaData | null>(null);
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
  const [fuItems, setFuItems] = useState<Array<{ q: string; a: string; respId: string | null; savedId?: string; baseQaId?: string; baseFuIndex?: number; baseIsAiMain?: boolean; relType?: string; relDir?: "current_to_new" | "new_to_current" }>>([]);
  const [relType, setRelType] = useState<string>("precedes");
  const [relDir, setRelDir] = useState<"current_to_new" | "new_to_current">("current_to_new");
  const [pairBusy, setPairBusy] = useState(false);
  const [fuMap, setFuMap] = useState<Record<string, { input: string; loading: boolean; items: Array<{ q: string; a: string; respId: string | null; savedId?: string; relType?: string; relDir?: "current_to_new" | "new_to_current" }> }>>({});
  const [connectedKw, setConnectedKw] = useState<Record<string, { keywords: string[]; phrases: string[] }>>({});
  const [fuPer, setFuPer] = useState<Record<number, { input: string; loading: boolean }>>({});
  const [anchor, setAnchor] = useState<{ type: "qa" | "ai" | "fu" | "node"; id?: string; index?: number } | null>(null);
  const [chainUnder, setChainUnder] = useState<Array<{ id: string; question: string; answer?: string; summary?: string }>>([]);

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
      // Ensure previous follow-up is saved if needed (attach to base QA so it shares root)
      if (!baseId) {
        const r1 = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: baseQ, answer: baseA, summary: undefined, responseId: baseRid || undefined, parentId: baseQaId, published: false }) });
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
      // Save current follow-up item if not yet saved (parentId=baseId to keep root consistent)
      let newId: string | undefined = entry.items[i].savedId;
      if (!newId) {
        const r2 = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: nextQ, answer: nextA, summary: undefined, responseId: entry.items[i].respId || undefined, parentId: baseId, published: false }) });
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
      const rType = entry.items[i].relType || relType;
      const rDir = entry.items[i].relDir || relDir;
      const sourceId = rDir === "current_to_new" ? baseId! : newId!;
      const targetId = rDir === "current_to_new" ? newId! : baseId!;
      const r3 = await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, targetId, type: rType, weight: 1 }) });
      if (!r3.ok) {
        let msg = "Relation failed";
        try { const ej = await r3.json(); if (ej?.error) msg = String(ej.error); } catch {}
        throw new Error(msg);
      }
      onGraphChanged?.();
      if (rDir === "current_to_new") { onSetSource?.(baseId!); onSetTarget?.(newId!); }
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
      let prevRid: string | undefined = undefined;
      if (qaId && baseQaId === qaId) {
        prevRid = (String(data?.lastResponseId || "").trim() || undefined) as string | undefined;
      } else {
        try {
          const r0 = await fetch(`/api/qa/${encodeURIComponent(baseQaId)}`, { cache: "no-store" });
          if (r0.ok) {
            const j0 = await r0.json();
            const rid0 = String(j0?.lastResponseId || "").trim();
            if (rid0) prevRid = rid0;
          }
        } catch {}
      }
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: q, history: [], provider, detail: "long", previousResponseId: prevRid, contextIds: ctxIds }) });
      if (!res.ok) throw new Error("AI call failed");
      const j = await res.json();
      const a = String(j?.answer || "");
      const rid = j?.responseId ? String(j.responseId) : null;
      if (qaId && baseQaId === qaId) {
        // Main QA: keep using flat fuItems at top
        setFuItems((prev) => {
          const arr = [...prev];
          const insertAt = 0;
          arr.splice(insertAt, 0, { q, a, respId: rid, baseQaId, relType, relDir });
          for (let k = 0; k < arr.length; k++) {
            if (k === insertAt) continue;
            const bf = arr[k]?.baseFuIndex;
            if (typeof bf === "number" && bf >= insertAt) {
              arr[k] = { ...arr[k], baseFuIndex: bf + 1 };
            }
          }
          return arr;
        });
      } else {
        // Connected node: append under that node's item list
        setFuMap((m) => {
          const prev = m[baseQaId] || { input: "", loading: false, items: [] };
          const items = [...prev.items, { q, a, respId: rid, relType, relDir }];
          return { ...m, [baseQaId]: { input: "", loading: false, items } };
        });
      }
      if (qaId && baseQaId === qaId) {
        setFuPer((m) => {
          const out: Record<number, { input: string; loading: boolean }> = {};
          const threshold = 0;
          for (const k of Object.keys(m)) {
            const n = Number(k);
            if (!Number.isFinite(n)) continue;
            const nk = n >= threshold ? n + 1 : n;
            out[nk] = m[n];
          }
          out[0] = { input: "", loading: false };
          return out;
        });
        // Also reset the main QA input so multiple branches can be asked easily
        setFuMap((m) => {
          const prev2 = m[baseQaId] || { input: "", loading: false, items: [] };
          return { ...m, [baseQaId]: { ...prev2, input: "", loading: false } };
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setFuMap((m) => {
        const prev2 = m[baseQaId] || { input: "", loading: false, items: [] };
        return { ...m, [baseQaId]: { ...prev2, loading: false } };
      });
    }
  }

  async function askFollowUpAt(idx: number) {
    const entry = fuPer[idx] || { input: "", loading: false };
    const q = (entry.input || "").trim();
    if (!q) return;
    try {
      setFuPer((m) => ({ ...m, [idx]: { ...(m[idx] || { input: "", loading: false }), loading: true } }));
      const ctxIds: string[] = qaId ? [qaId] : [];
      const baseRid = fuItems[idx]?.respId || (qaId ? (data?.lastResponseId as string | undefined) : aiResponseId);
      const prevRid = baseRid || undefined;
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: q, history: [], provider, detail: "long", previousResponseId: prevRid, contextIds: ctxIds }) });
      if (!res.ok) throw new Error("AI call failed");
      const j = await res.json();
      const a = String(j?.answer || "");
      const rid = j?.responseId ? String(j.responseId) : null;
      setFuItems((prev) => {
        const arr = [...prev];
        // Option B: insert immediately under the anchor card
        const insertAt = Math.min(idx + 1, arr.length);
        arr.splice(insertAt, 0, { q, a, respId: rid, baseFuIndex: idx, relType, relDir });
        // rebase indices for items shifted to the right
        for (let k = 0; k < arr.length; k++) {
          if (k === insertAt) continue; // skip the newly inserted item
          const bf = arr[k]?.baseFuIndex;
          if (typeof bf === "number" && bf >= insertAt) {
            arr[k] = { ...arr[k], baseFuIndex: bf + 1 };
          }
        }
        return arr;
      });
      setFuPer((m) => {
        const out: Record<number, { input: string; loading: boolean }> = {};
        const threshold = idx + 1;
        for (const k of Object.keys(m)) {
          const n = Number(k);
          if (!Number.isFinite(n)) continue;
          const nk = n >= threshold ? n + 1 : n;
          out[nk] = m[n];
        }
        // Ensure the original anchor input remains available for additional branching
        out[idx] = { input: "", loading: false };
        // Provide a fresh input under the newly inserted item as well
        out[idx + 1] = { input: "", loading: false };
        return out;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setFuPer((m) => ({ ...m, [idx]: { ...(m[idx] || { input: "" }), loading: false } }));
    }
  }

  async function askFollowUp() {
    const q = fuInput.trim();
    if (!q) return;
    try {
      setFuLoading(true);
      const ctxIds: string[] = [];
      const baseRid = aiResponseId;
      const prevRid = baseRid || undefined;
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: q, history: [], provider, detail: "long", previousResponseId: prevRid, contextIds: ctxIds }) });
      if (!res.ok) throw new Error("AI call failed");
      const j = await res.json();
      const a = String(j?.answer || "");
      const rid = j?.responseId ? String(j.responseId) : null;
      setFuItems((prev) => {
        const arr = [...prev];
        // Option B for AI main: insert immediately under main (top of list)
        const insertAt = 0;
        arr.splice(insertAt, 0, { q, a, respId: rid, baseIsAiMain: true, relType, relDir });
        // reindex baseFuIndex for items shifted to the right
        for (let k = 0; k < arr.length; k++) {
          if (k === insertAt) continue;
          const bf = arr[k]?.baseFuIndex;
          if (typeof bf === "number" && bf >= insertAt) {
            arr[k] = { ...arr[k], baseFuIndex: bf + 1 };
          }
        }
        return arr;
      });
      setFuPer((m) => {
        const out: Record<number, { input: string; loading: boolean }> = {};
        const threshold = 0;
        for (const k of Object.keys(m)) {
          const n = Number(k);
          if (!Number.isFinite(n)) continue;
          const nk = n >= threshold ? n + 1 : n;
          out[nk] = m[n];
        }
        out[0] = { input: "", loading: false };
        return out;
      });
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
      // Determine base (flat chain aware)
      let baseId: string | undefined;
      let baseQ = "";
      let baseA = "";
      let baseRid: string | undefined = undefined;
      const item = fuItems[i];
      if (item.baseQaId) {
        baseId = item.baseQaId;
        const node = mapNodes.find((n) => n.id === baseId);
        baseQ = String(node?.question || "");
        baseA = String(node?.answer || node?.summary || "");
      } else if (typeof item.baseFuIndex === "number" && item.baseFuIndex >= 0 && item.baseFuIndex < fuItems.length) {
        const prevItem = fuItems[item.baseFuIndex];
        baseQ = prevItem.q;
        baseA = prevItem.a;
        baseRid = prevItem.respId || undefined;
        baseId = prevItem.savedId;
      } else {
        if (qaId) {
          baseId = qaId as string;
          baseQ = String(data?.question || "");
          baseA = String(data?.answer || data?.summary || "");
          baseRid = String(data?.lastResponseId || "") || undefined;
        } else {
          baseQ = String(question || "");
          baseA = String(aiAnswer || "");
          baseRid = aiResponseId || undefined;
        }
      }
      // Ensure base saved if needed (for flat chain: attach first FU to qaId to keep chain under same root)
      if (!baseId) {
        const ok = typeof window !== "undefined" ? window.confirm("기준 Q&A를 초안으로 저장하고 관계를 생성할까요?") : true;
        if (!ok) { setPairBusy(false); return; }
        const r1 = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: baseQ, answer: baseA, summary: undefined, responseId: baseRid || undefined, parentId: qaId ? (qaId as string) : undefined, published: false }) });
        if (!r1.ok) throw new Error("Base save failed");
        const j1 = await r1.json();
        baseId = String(j1?.id || "");
        if (!baseId) throw new Error("No baseId");
        // Persist savedId onto referenced previous fu item if applicable
        if (typeof item.baseFuIndex === "number" && item.baseFuIndex >= 0) {
          setFuItems((prevArr) => {
            const arr = [...prevArr];
            const baseIdx = item.baseFuIndex as number;
            arr[baseIdx] = { ...arr[baseIdx], savedId: baseId! };
            return arr;
          });
        }
      }
      // Save current follow-up item if not yet saved (parentId=baseId so new stays in same root)
      let newId: string | undefined = fuItems[i].savedId;
      if (!newId) {
        const r2 = await fetch("/api/qa/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: nextQ, answer: nextA, summary: undefined, responseId: fuItems[i].respId || undefined, parentId: baseId, published: false }) });
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
      const rType = fuItems[i].relType || relType;
      const rDir = fuItems[i].relDir || relDir;
      const sourceId = rDir === "current_to_new" ? baseId! : newId!;
      const targetId = rDir === "current_to_new" ? newId! : baseId!;
      const r3 = await fetch("/api/qa/relation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, targetId, type: rType, weight: 1 }) });
      if (!r3.ok) {
        let msg = "Relation failed";
        try { const ej = await r3.json(); if (ej?.error) msg = String(ej.error); } catch {}
        throw new Error(msg);
      }
      onGraphChanged?.();
      if (rDir === "current_to_new") { onSetSource?.(baseId!); onSetTarget?.(newId!); }
      else { onSetSource?.(newId!); onSetTarget?.(baseId!); }
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

  // Reset when switching QA context
  useEffect(() => {
    setFuItems([]);
    setFuInput("");
    setFuMap({});
    setFuPer({});
  }, [qaId]);

  // Reset when switching AI main context (only when not in QA mode)
  useEffect(() => {
    if (qaId) return;
    setFuItems([]);
    setFuInput("");
    setFuMap({});
    setFuPer({});
  }, [question, aiAnswer]);

  useEffect(() => {
    // Preload keyword chips for connected QAs (source->current and current->target)
    (async () => {
      try {
        if (!qaId) return;
        const showIds = new Set<string>();
        for (const e of mapEdges) {
          if (e.targetId === qaId) showIds.add(e.sourceId);
          if (e.sourceId === qaId) showIds.add(e.targetId);
        }
        const ids = Array.from(showIds).filter((id) => connectedKw[id] === undefined);
        if (ids.length === 0) return;
        const next: Record<string, { keywords: string[]; phrases: string[] }> = {};
        for (const id of ids) {
          const node = mapNodes.find((n) => n.id === id);
          const text = String(node?.answer || node?.summary || "");
          if (!text.trim()) { next[id] = { keywords: [], phrases: [] }; continue; }
          try {
            const r = await fetch("/api/ai/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, max: 8 }) });
            const j = await r.json().catch(() => ({ keywords: [], phrases: [] }));
            next[id] = { keywords: Array.isArray(j?.keywords) ? j.keywords : [], phrases: Array.isArray(j?.phrases) ? j.phrases : [] };
          } catch { next[id] = { keywords: [], phrases: [] }; }
        }
        setConnectedKw((prev) => ({ ...prev, ...next }));
      } catch {}
    })();
  }, [qaId, JSON.stringify(mapEdges), JSON.stringify(mapNodes.map((n) => [n.id, n.answer, n.summary]))]);

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

  useEffect(() => {
    try {
      if (!qaId) { setChainUnder([]); return; }
      const idToNode = new Map(mapNodes.map((n) => [n.id, n] as const));
      // If a specific chain path is provided and includes the current qaId, follow that path
      if (Array.isArray(selectedChainPath) && selectedChainPath.includes(qaId)) {
        const idx = selectedChainPath.indexOf(qaId);
        const tail = selectedChainPath.slice(idx + 1);
        const out: Array<{ id: string; question: string; answer?: string; summary?: string }> = [];
        for (const id of tail) {
          const node = idToNode.get(id);
          if (node) out.push({ id: node.id, question: node.question, answer: node.answer, summary: node.summary });
        }
        setChainUnder(out);
        return;
      }
      // Fallback heuristic: first-unseen forward walk
      const nexts = new Map<string, string[]>();
      for (const e of mapEdges) {
        if ((e?.type || "").toLowerCase() !== "precedes") continue;
        const s = e.sourceId; const t = e.targetId;
        if (!nexts.has(s)) nexts.set(s, []);
        nexts.get(s)!.push(t);
      }
      const out: Array<{ id: string; question: string; answer?: string; summary?: string }> = [];
      const seen = new Set<string>();
      let cur: string | null = qaId;
      while (cur) {
        const arr: string[] = nexts.get(cur) ?? ([] as string[]);
        if (arr.length === 0) break;
        let nxt: string | null = null;
        for (const t of arr) { if (!seen.has(t)) { nxt = t; break; } }
        if (!nxt) break;
        if (seen.has(nxt)) break;
        seen.add(nxt);
        const node = idToNode.get(nxt);
        if (node) out.push({ id: node.id, question: node.question, answer: node.answer, summary: node.summary });
        cur = nxt;
      }
      setChainUnder(out);
    } catch { setChainUnder([]); }
  }, [qaId, JSON.stringify(mapEdges), JSON.stringify(mapNodes.map((n) => [n.id, n.answer, n.summary])), JSON.stringify(selectedChainPath || [])]);

  // Prefill visible follow-ups from downstream chain when opening a saved QA
  useEffect(() => {
    if (!qaId) return;
    if (fuItems.length > 0) return;
    if (chainUnder.length === 0) return;
    const mapped = chainUnder.map((n) => ({ q: n.question, a: String(n.answer || n.summary || ""), respId: null as string | null, savedId: n.id }));
    setFuItems(mapped);
  }, [qaId, chainUnder.length]);

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
    if (qaId && data?.lastResponseId) { onSetPrevRespId?.(String(data.lastResponseId)); return; }
    if (!qaId && aiResponseId) { onSetPrevRespId?.(String(aiResponseId)); return; }
    onSetPrevRespId?.(null);
  }, [qaId, data?.lastResponseId, aiResponseId]);

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
    type PatchNode = { id: string; type: NodeType; title: string };
    type PatchEdge = { id: string; sourceId: string; targetId: string; type: EdgeType };
    type AddNodeOp = { op: "add_node"; node: PatchNode };
    type AddEdgeOp = { op: "add_edge"; edge: PatchEdge };

    const isAddNodeOp = (op: unknown): op is AddNodeOp => {
      if (typeof op !== "object" || !op) return false;
      const o = op as Record<string, unknown>;
      return o["op"] === "add_node" && typeof o["node"] === "object" && !!o["node"];
    };
    const isAddEdgeOp = (op: unknown): op is AddEdgeOp => {
      if (typeof op !== "object" || !op) return false;
      const o = op as Record<string, unknown>;
      return o["op"] === "add_edge" && typeof o["edge"] === "object" && !!o["edge"];
    };

    const addedNodes: PatchNode[] = patch.ops.filter(isAddNodeOp).map((op) => op.node);
    const addedEdges: PatchEdge[] = patch.ops.filter(isAddEdgeOp).map((op) => op.edge);

    const allTypes: NodeType[] = ["premise","inference","conclusion","claim","concept","evidence","source","qa"];
    const present = new Set<NodeType>(addedNodes.map((n) => n.type));
    const cols: NodeType[] = allTypes.filter((t) => present.has(t));
    const colX = (col: number, W: number) => {
      const padding = 24; const span = W - padding * 2; return padding + (span * col) / Math.max(1, (cols.length - 1));
    };
    const byType = new Map<NodeType, PatchNode[]>();
    cols.forEach((t) => byType.set(t, addedNodes.filter((n) => n.type === t)));
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
          {( ["supports","refutes","relates_to","cites","infers"] as EdgeType[] ).map((t) => (
            <marker key={t} id={`arrow-mini-${t}`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={colorFor(t)} />
            </marker>
          ))}
        </defs>
        {addedEdges
          .filter((e) => pos.has(e.sourceId) && pos.has(e.targetId))
          .map((e) => {
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
    const rawPatch = (data as Record<string, unknown>)?.patch as unknown;
    let patchVal: unknown = rawPatch;
    try { if (typeof rawPatch === "string") patchVal = JSON.parse(rawPatch); } catch {}
    const hasLlmPatch = Array.isArray((patchVal as Record<string, unknown>)?.["ops"] as unknown[]);
    const neighborIds: string[] = (() => {
      const s = new Set<string>();
      for (const e of mapEdges) {
        if (e.targetId === qaId) s.add(e.sourceId);
        if (e.sourceId === qaId) s.add(e.targetId);
      }
      return Array.from(s);
    })();
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Q: {data.question}</div>
        {/* Top action bar removed per UX change */}
        <div className="flex items-center gap-2 text-[11px] text-gray-600">
          <span className={`px-2 py-0.5 rounded-full border ${data.published !== false ? 'bg-green-50 border-green-200 text-green-700' : 'bg-yellow-50 border-yellow-200 text-yellow-700'}`}>{data.published !== false ? 'Published' : 'Draft'}</span>
          {data.createdBy && <span>by {data.createdBy}</span>}
          {data.lastResponseId && <span className="truncate max-w-[50%]" title={data.lastResponseId}>RID: {data.lastResponseId}</span>}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white" onClick={() => { if (qaId) onSetCard?.(qaId); }}>가이드에 추가</button>
          <button className="text-xs px-2 py-1 rounded border" onClick={() => setEditing((v) => !v)}>{editing ? "편집 취소" : "개선하기"}</button>
          <button className="text-xs px-2 py-1 rounded border" onClick={() => { if (!qaId) return; try { const url = location.origin + "/?qa=" + encodeURIComponent(qaId); navigator.clipboard?.writeText(url); } catch {} }}>공유하기</button>
        </div>
        {data.answer && <div className="text-sm whitespace-pre-wrap break-words">A: {data.answer}</div>}
        {/* Summary display suppressed per UX request */}
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
        <div className="mt-2 flex items-center gap-2">
          <input className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" placeholder="이 카드에서 이어서 물어보기" value={qaId ? (fuMap[qaId]?.input ?? '') : ''} onFocus={() => { if (qaId) setAnchor({ type: 'qa', id: qaId }); }} onChange={(e) => { if (!qaId) return; setFuMap((m) => ({ ...m, [qaId]: { ...(m[qaId] || { input: '', loading: false, items: [] }), input: e.target.value } })); }} />
          <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={!qaId || !!(fuMap[qaId]?.loading) || !(((qaId && fuMap[qaId]?.input) ?? '').trim())} onClick={() => { if (qaId) { setAnchor({ type: 'qa', id: qaId }); void askFollowUpFor(qaId); } }}>{qaId && fuMap[qaId]?.loading ? "요청 중…" : "이 카드에서 답변 받기"}</button>
          {anchor?.type === 'qa' && anchor.id === qaId && (
            <span className="text-[10px] px-1.5 py-[2px] rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700">앵커</span>
          )}
        </div>
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
        <div className="mt-3">
          <div className="text-xs text-gray-700 mb-1">후속 질문</div>
          {fuItems.length > 0 && (
            <div className="space-y-2">
              {fuItems.map((it, i) => (
                <div key={`fu-${i}`} className={`py-2 ${((fuItems[i+1]?.baseFuIndex === i) || (fuItems[i]?.baseFuIndex === i-1)) ? 'pl-2 border-l border-gray-200' : ''}`}>
                  <div className="text-[11px] text-gray-600 mb-1">
                    관계: {(it.relDir || relDir) === 'current_to_new' ? '기준 → 후속' : '후속 → 기준'} · {labelKoForType(it.relType || relType)}
                    {anchor?.type === 'fu' && anchor.index === i && (
                      <span className="ml-2 text-[10px] px-1.5 py-[2px] rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700">앵커</span>
                    )}
                  </div>
                  <div className="text-sm font-semibold">Q: {it.q}</div>
                  <div className="text-sm whitespace-pre-wrap break-words mt-1">A: {it.a}</div>
                  <div className="mt-1 text-[10px] text-gray-500">{it.respId ? `RID: ${it.respId}` : ''}</div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <select className="text-xs border rounded px-2 py-1" value={it.relType || relType} onChange={(e) => setFuItems((prev) => { const val = e.target.value; const arr = [...prev]; const dir = defaultDirForType(val); arr[i] = { ...arr[i], relType: val, relDir: dir }; return arr; })}>
                      {Object.entries(REL_HEADS).map(([hk, hv]) => (
                        <optgroup key={hk} label={hv.label}>
                          {hv.types.map((opt) => (
                            <option key={opt.type} value={opt.type}>{opt.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <select className="text-xs border rounded px-2 py-1" value={it.relDir || relDir} onChange={(e) => setFuItems((prev) => { const arr = [...prev]; arr[i] = { ...arr[i], relDir: e.target.value as RelDir }; return arr; })}>
                      <option value="current_to_new">현재 → 후속</option>
                      <option value="new_to_current">후속 → 현재</option>
                    </select>
                    <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={pairBusy} onClick={() => void savePairAndRelAt(i)}>{pairBusy ? "저장 중…" : "두 Q&A 저장 및 관계 생성"}</button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" placeholder="이 카드에서 이어서 물어보기" value={fuPer[i]?.input ?? ''} onFocus={() => setAnchor({ type: 'fu', index: i })} onChange={(e) => setFuPer((m) => ({ ...m, [i]: { ...(m[i] || { input: '', loading: false }), input: e.target.value } }))} />
                    <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={!!(fuPer[i]?.loading) || !((fuPer[i]?.input ?? '').trim())} onClick={() => { setAnchor({ type: 'fu', index: i }); void askFollowUpAt(i); }}>{fuPer[i]?.loading ? "요청 중…" : "이 카드에서 답변 받기"}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          
        </div>
        {neighborIds.length > 0 && (
          <div className="mt-4">
            <div className="text-xs text-gray-700 mb-1">연결된 노드</div>
            <ul className="space-y-3">
              {neighborIds.map((nid) => {
                const node = mapNodes.find((n) => n.id === nid);
                if (!node) return null;
                const entry = fuMap[nid] || { input: "", loading: false, items: [] };
                return (
                  <li key={nid} className="rounded border border-gray-200/60 p-2 bg-white/60 dark:bg-gray-900/40">
                    <div className="text-sm font-medium truncate">Q: {node.question}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <input className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" placeholder="이 카드에서 이어서 물어보기" value={fuMap[nid]?.input ?? ''} onFocus={() => setAnchor({ type: 'qa', id: nid })} onChange={(e) => setFuMap((m) => ({ ...m, [nid]: { ...(m[nid] || { input: '', loading: false, items: [] }), input: e.target.value } }))} />
                      <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={!!(fuMap[nid]?.loading) || !((fuMap[nid]?.input ?? '').trim())} onClick={() => { setAnchor({ type: 'qa', id: nid }); void askFollowUpFor(nid); }}>{fuMap[nid]?.loading ? "요청 중…" : "이 카드에서 답변 받기"}</button>
                      {anchor?.type === 'qa' && anchor.id === nid && (
                        <span className="text-[10px] px-1.5 py-[2px] rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700">앵커</span>
                      )}
                    </div>
                    {entry.items.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {entry.items.map((cit, ci) => (
                          <div key={`c-${nid}-${ci}`} className="py-2">
                            <div className="text-[11px] text-gray-600 mb-1">
                              관계: {(cit.relDir || relDir) === 'current_to_new' ? '기준 → 후속' : '후속 → 기준'} · {labelKoForType(cit.relType || relType)}
                              {anchor?.type === 'fu' && anchor.index === ci && anchor.id === nid && (
                                <span className="ml-2 text-[10px] px-1.5 py-[2px] rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700">앵커</span>
                              )}
                            </div>
                            <div className="text-sm font-semibold">Q: {cit.q}</div>
                            <div className="text-sm whitespace-pre-wrap break-words mt-1">A: {cit.a}</div>
                            <div className="mt-1 text-[10px] text-gray-500">{cit.respId ? `RID: ${cit.respId}` : ''}</div>
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              <select className="text-xs border rounded px-2 py-1" value={cit.relType || relType} onChange={(e) => setFuMap((m) => { const val = e.target.value; const prev = m[nid] || { input: '', loading: false, items: [] }; const arr = [...prev.items]; const dir = defaultDirForType(val); arr[ci] = { ...arr[ci], relType: val, relDir: dir }; return { ...m, [nid]: { ...prev, items: arr } }; })}>
                                {Object.entries(REL_HEADS).map(([hk, hv]) => (
                                  <optgroup key={hk} label={hv.label}>
                                    {hv.types.map((opt) => (
                                      <option key={opt.type} value={opt.type}>{opt.label}</option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                              <select className="text-xs border rounded px-2 py-1" value={cit.relDir || relDir} onChange={(e) => setFuMap((m) => { const prev = m[nid] || { input: '', loading: false, items: [] }; const arr = [...prev.items]; arr[ci] = { ...arr[ci], relDir: e.target.value as RelDir }; return { ...m, [nid]: { ...prev, items: arr } }; })}>
                                <option value="current_to_new">현재 → 후속</option>
                                <option value="new_to_current">후속 → 현재</option>
                              </select>
                              <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={pairBusy} onClick={() => void savePairAndRelAtFor(nid, ci)}>{pairBusy ? "저장 중…" : "두 Q&A 저장 및 관계 생성"}</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
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
            <PatchPreviewGraph patch={patchVal as LlmPatch} />
          </div>
        )}
        
      </div>
    );
  }

  if (question && aiAnswer) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Q: {question}</div>
        <div className="text-sm whitespace-pre-wrap break-words">A: {aiAnswer}</div>
        {(aiProvider || aiModel || aiResponseId) && (
          <div className="text-[11px] text-gray-600">
            via {aiProvider === "anthropic" ? "Anthropic (Claude)" : aiProvider === "openai" ? "OpenAI" : "AI"}
            {aiModel ? ` · ${aiModel}` : ""}
            {aiFallbackUsed ? " · fallback" : ""}
            {aiResponseId ? ` · RID: ${aiResponseId}` : ""}
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button
            className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
            disabled={saving}
            onClick={() => void shareAnd("card")}
          >{saving ? "Sharing..." : "가이드에 추가"}</button>
          <button
            className="text-xs px-2 py-1 rounded border disabled:opacity-50"
            disabled={saving}
            onClick={() => void shareNew()}
          >{saving ? "Sharing..." : "공유하기"}</button>
        </div>
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
        <div className="flex items-center gap-2 mt-2">
          <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={saving} onClick={() => void shareAnd("source")}>{saving ? "Sharing..." : "Set Source"}</button>
          <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={saving} onClick={() => void shareAnd("target")}>{saving ? "Sharing..." : "Set Target"}</button>
          <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={saving} onClick={() => void shareAnd("card")}>{saving ? "Sharing..." : "Set Card"}</button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" placeholder="이 카드에서 이어서 물어보기" value={fuInput} onFocus={() => setAnchor({ type: 'ai' })} onChange={(e) => setFuInput(e.target.value)} />
          <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={fuLoading || !fuInput.trim()} onClick={() => { setAnchor({ type: 'ai' }); void askFollowUp(); }}>{fuLoading ? "요청 중…" : "이 카드에서 답변 받기"}</button>
          {anchor?.type === 'ai' && (
            <span className="text-[10px] px-1.5 py-[2px] rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700">앵커</span>
          )}
        </div>
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
        <div className="mt-3">
          <div className="text-xs text-gray-700 mb-1">후속 질문</div>
          {fuItems.length > 0 && (
            <div className="space-y-2">
              {fuItems.map((it, i) => (
                <div key={`fu2-${i}`} className={`py-2 ${((fuItems[i+1]?.baseFuIndex === i) || (fuItems[i]?.baseFuIndex === i-1)) ? 'pl-2 border-l border-gray-200' : ''}`}>
                  <div className="text-[11px] text-gray-600 mb-1">
                    관계: {(it.relDir || relDir) === 'current_to_new' ? '기준 → 후속' : '후속 → 기준'} · {labelKoForType(it.relType || relType)}
                  </div>
                  <div className="text-sm font-semibold">Q: {it.q}</div>
                  <div className="text-sm whitespace-pre-wrap mt-1">A: {it.a}</div>
                  <div className="mt-1 text-[10px] text-gray-500">{it.respId ? `RID: ${it.respId}` : ''}</div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <select className="text-xs border rounded px-2 py-1" value={it.relType || relType} onChange={(e) => setFuItems((prev) => { const val = e.target.value; const arr = [...prev]; const dir = defaultDirForType(val); arr[i] = { ...arr[i], relType: val, relDir: dir }; return arr; })}>
                      {Object.entries(REL_HEADS).map(([hk, hv]) => (
                        <optgroup key={hk} label={hv.label}>
                          {hv.types.map((opt) => (
                            <option key={opt.type} value={opt.type}>{opt.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <select className="text-xs border rounded px-2 py-1" value={it.relDir || relDir} onChange={(e) => setFuItems((prev) => { const arr = [...prev]; arr[i] = { ...arr[i], relDir: e.target.value as RelDir }; return arr; })}>
                      <option value="current_to_new">현재 → 후속</option>
                      <option value="new_to_current">후속 → 현재</option>
                    </select>
                    <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={pairBusy} onClick={() => void savePairAndRelAt(i)}>{pairBusy ? "저장 중…" : "두 Q&A 저장 및 관계 생성"}</button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input className="flex-1 rounded border border-gray-300 bg-white/90 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900/60" placeholder="이 카드에서 이어서 물어보기" value={fuPer[i]?.input ?? ''} onChange={(e) => setFuPer((m) => ({ ...m, [i]: { ...(m[i] || { input: '', loading: false }), input: e.target.value } }))} />
                    <button className="text-xs px-2 py-1 rounded border disabled:opacity-50" disabled={!!(fuPer[i]?.loading) || !((fuPer[i]?.input ?? '').trim())} onClick={() => void askFollowUpAt(i)}>{fuPer[i]?.loading ? "요청 중…" : "이 카드에서 답변 받기"}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (question && !aiAnswer) {
    return <div className="text-xs text-gray-600">유사한 Q&amp;A를 선택하거나 좌측에서 &quot;지금 AI에게 묻기&quot;를 눌러 답변을 받아보세요.</div>;
  }

  return <div className="text-xs text-gray-500">좌측에서 질문을 입력하세요.</div>;
}
