"use client";

import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { HelpCircle, Search, Sun, Moon, Sparkles, Globe2 } from "lucide-react";
import { getActiveTheme, setTheme } from "@/lib/theme";

type QaHit = {
  id: string;
  question: string;
  summary?: string;
  created_by?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSelectQA: (id: string) => void;
  onAskAI?: (question: string) => void;
};

export default function CommandPalette({ open, onClose, onSelectQA, onAskAI }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<QaHit[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!q) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myId = ++reqIdRef.current;
    debounceRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/qa/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, limit: 8 }),
        });
        const j = await res.json().catch(() => ({}));
        if (reqIdRef.current !== myId) return;
        const rows = Array.isArray(j?.items) ? j.items : Array.isArray(j?.results) ? j.results : Array.isArray(j) ? j : [];
        setHits(rows as QaHit[]);
      } catch {
        if (reqIdRef.current === myId) setHits([]);
      } finally {
        if (reqIdRef.current === myId) setLoading(false);
      }
    }, 180);
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [open, query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (open && e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const trimmed = query.trim();
  const themeNow = typeof document !== "undefined" ? getActiveTheme() : "light";

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <Command
        className="w-[92%] max-w-xl rounded-[var(--radius-lg)] bg-[color:var(--bg-elevated)] text-[color:var(--text-normal)] border border-[color:var(--border)] shadow-2xl overflow-hidden"
        shouldFilter={false}
        loop
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[color:var(--border)]">
          <Search size={14} strokeWidth={1.75} className="text-[color:var(--text-faint)]" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Q&A 검색 또는 AI에게 질문…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--text-faint)]"
          />
          <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-[color:var(--bg-secondary)] border border-[color:var(--border)] text-[color:var(--text-faint)]">ESC</kbd>
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-1">
          {loading && (
            <div className="px-3 py-2 text-xs text-[color:var(--text-muted)]">검색 중…</div>
          )}
          {!loading && trimmed.length === 0 && (
            <Command.Group heading="액션" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[color:var(--text-faint)]">
              <PaletteItem
                value="theme-toggle"
                icon={themeNow === "dark" ? <Sun size={14} strokeWidth={1.75} /> : <Moon size={14} strokeWidth={1.75} />}
                label={themeNow === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
                onSelect={() => {
                  setTheme(themeNow === "dark" ? "light" : "dark");
                  onClose();
                }}
              />
              <PaletteItem
                value="hint-search"
                icon={<Globe2 size={14} strokeWidth={1.75} />}
                label="Q&A 검색 — 키워드 입력"
                hint="↑↓ 선택 · ↵ 열기"
                onSelect={() => { /* no-op */ }}
                muted
              />
            </Command.Group>
          )}

          {!loading && trimmed.length > 0 && hits.length === 0 && (
            <div className="px-3 py-3 text-xs text-[color:var(--text-muted)]">
              일치하는 Q&A가 없습니다.
              {onAskAI && (
                <>
                  {" "}
                  <button
                    onClick={() => { onAskAI(trimmed); onClose(); }}
                    className="underline hover:text-[color:var(--text-normal)]"
                  >
                    AI에게 직접 질문하기 →
                  </button>
                </>
              )}
            </div>
          )}

          {!loading && hits.length > 0 && (
            <Command.Group heading={`Q&A · ${hits.length}건`} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[color:var(--text-faint)]">
              {hits.map((h) => (
                <PaletteItem
                  key={h.id}
                  value={`qa:${h.id}`}
                  icon={<HelpCircle size={14} strokeWidth={1.75} />}
                  label={h.question || "(제목 없음)"}
                  hint={h.created_by ? `by ${h.created_by}` : undefined}
                  subtext={h.summary || undefined}
                  onSelect={() => { onSelectQA(h.id); onClose(); }}
                />
              ))}
            </Command.Group>
          )}

          {!loading && trimmed.length > 0 && onAskAI && (
            <Command.Group heading="" className="[&_[cmdk-group-heading]]:hidden">
              <PaletteItem
                value="ask-ai"
                icon={<Sparkles size={14} strokeWidth={1.75} />}
                label={`AI에게 질문: "${trimmed}"`}
                onSelect={() => { onAskAI(trimmed); onClose(); }}
              />
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

function PaletteItem({
  value,
  icon,
  label,
  hint,
  subtext,
  muted,
  onSelect,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  subtext?: string;
  muted?: boolean;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={`group flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] cursor-pointer text-sm aria-selected:bg-[color:var(--bg-active)] aria-selected:text-[color:var(--text-normal)] hover:bg-[color:var(--bg-hover)] ${muted ? "opacity-60" : ""}`}
    >
      <span className="text-[color:var(--text-muted)] group-aria-selected:text-[color:var(--accent)] shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate">{label}</span>
        {subtext && <span className="block text-[11px] text-[color:var(--text-faint)] truncate">{subtext}</span>}
      </span>
      {hint && <span className="text-[10px] text-[color:var(--text-faint)] font-mono shrink-0">{hint}</span>}
    </Command.Item>
  );
}
