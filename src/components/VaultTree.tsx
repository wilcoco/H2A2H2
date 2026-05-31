"use client";

import { useEffect, useState } from "react";

type NodeT = {
  id: string;
  question: string;
  summary: string | null;
  parentId: string | null;
  forkedFrom: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
};

type Branch = {
  rootId: string;
  rootQuestion: string;
  createdBy: string | null;
  createdAt: string;
  nodeCount: number;
  verified: boolean;
  dormant: boolean;
  hasFork: boolean;
  nodes: NodeT[];
};

type Props = {
  signedIn: boolean;
  onSelect?: (qaId: string) => void;
  refreshKey?: number;
};

// Obsidian Sync 풍 vault 폴더 트리. 스코프(공개/내것/스테이크)를 폴더처럼 전환.
export default function VaultTree({ signedIn, onSelect, refreshKey }: Props) {
  const [scope, setScope] = useState<"public" | "mine" | "stake">("public");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/qa/vault?scope=${scope}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!active) return;
        setBranches(Array.isArray(j?.branches) ? j.branches : []);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [scope, refreshKey]);

  function toggle(rid: string) {
    setOpened((s) => {
      const n = new Set(s);
      if (n.has(rid)) n.delete(rid); else n.add(rid);
      return n;
    });
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-1">
        {(["public", "mine", "stake"] as const).map((s) => (
          <button
            key={s}
            className={`text-[10px] px-2 py-0.5 rounded border ${scope === s ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:bg-gray-50"} disabled:opacity-50`}
            onClick={() => setScope(s)}
            disabled={(s === "mine" || s === "stake") && !signedIn}
            title={s === "public" ? "전체 공개 가지" : s === "mine" ? "내가 만든 가지" : "내가 스테이크 건 가지"}
          >{s === "public" ? "📂 공개" : s === "mine" ? "📁 내 것" : "🪙 스테이크"}</button>
        ))}
      </div>
      {loading ? (
        <div className="text-[11px] text-gray-400">로딩…</div>
      ) : branches.length === 0 ? (
        <div className="text-[11px] text-gray-400">표시할 가지 없음</div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {branches.map((b) => {
            const open = opened.has(b.rootId);
            return (
              <li key={b.rootId}>
                <div className="flex items-center gap-1 hover:bg-gray-50 rounded px-1 py-0.5">
                  <button className="text-[10px] w-3 text-gray-500" onClick={() => toggle(b.rootId)}>{open ? "▾" : "▸"}</button>
                  <button
                    className="text-[12px] flex-1 text-left truncate"
                    onClick={() => onSelect?.(b.rootId)}
                    title={b.rootQuestion}
                  >{b.rootQuestion}</button>
                  {b.verified && <span className="text-[9px] text-emerald-600" title="검증된 가지">✓</span>}
                  {b.dormant && <span className="text-[9px] text-amber-600" title="잠복">💤</span>}
                  {b.hasFork && <span className="text-[9px] text-blue-600" title="포크 있음">⑂</span>}
                  <span className="text-[9px] text-gray-400">{b.nodeCount}</span>
                </div>
                {open && (
                  <ul className="ml-4 border-l border-gray-200 pl-1">
                    {b.nodes.filter((n) => n.id !== b.rootId).map((n) => (
                      <li key={n.id}>
                        <button
                          className="text-[11px] w-full text-left truncate text-gray-700 hover:bg-gray-50 rounded px-1 py-0.5"
                          onClick={() => onSelect?.(n.id)}
                          title={n.question}
                        >
                          {n.forkedFrom ? "⑂ " : "↳ "}
                          {n.question}
                          {n.status === "dormant" && <span className="text-amber-500 ml-1">💤</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
