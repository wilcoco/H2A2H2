"use client";

import { Crosshair, Globe2 } from "lucide-react";

type Props = {
  localMode: boolean;
  hops: number;
  onToggleLocal: (next: boolean) => void;
  onHopsChange: (next: number) => void;
  hasFocus: boolean;
  totalNodes?: number;
  shownNodes?: number;
};

const MIN_HOPS = 1;
const MAX_HOPS = 5;

export default function LocalGraphControls({ localMode, hops, onToggleLocal, onHopsChange, hasFocus, totalNodes, shownNodes }: Props) {
  return (
    <div className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--bg-elevated)] px-2 py-1 text-[11px] text-[color:var(--text-muted)]">
      <button
        type="button"
        onClick={() => onToggleLocal(false)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] transition-colors ${!localMode ? "bg-[color:var(--bg-active)] text-[color:var(--text-normal)]" : "hover:bg-[color:var(--bg-hover)]"}`}
        title="전체 그래프"
      >
        <Globe2 size={12} strokeWidth={1.75} />
        <span>전체</span>
      </button>
      <button
        type="button"
        disabled={!hasFocus}
        onClick={() => onToggleLocal(true)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${localMode ? "bg-[color:var(--bg-active)] text-[color:var(--text-normal)]" : "hover:bg-[color:var(--bg-hover)]"}`}
        title={hasFocus ? "현재 노드 기준 N-hop만 표시" : "포커스 노드를 선택하세요"}
      >
        <Crosshair size={12} strokeWidth={1.75} />
        <span>로컬</span>
      </button>
      {localMode && hasFocus && (
        <>
          <span className="text-[color:var(--text-faint)]">·</span>
          <label className="inline-flex items-center gap-1.5" title="이웃 깊이 (hop)">
            <span className="font-mono text-[color:var(--text-faint)]">hop</span>
            <input
              type="range"
              min={MIN_HOPS}
              max={MAX_HOPS}
              step={1}
              value={hops}
              onChange={(e) => onHopsChange(Number(e.target.value))}
              className="w-20 accent-[color:var(--accent)]"
            />
            <span className="font-mono w-3 text-center text-[color:var(--text-normal)]">{hops}</span>
          </label>
        </>
      )}
      {typeof totalNodes === "number" && typeof shownNodes === "number" && totalNodes > 0 && (
        <span className="text-[color:var(--text-faint)] font-mono ml-1">
          {shownNodes}/{totalNodes}
        </span>
      )}
    </div>
  );
}
