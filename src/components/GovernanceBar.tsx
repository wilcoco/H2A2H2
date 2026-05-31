"use client";

import { useEffect, useState } from "react";

type State = {
  phase: "bootstrap" | "decentralized";
  adminEmail: string | null;
  decentralizeAt: number;
  councilQuorumPct: number;
  participantCount: number;
  councilSize: number;
  remainingToDecentralize: number;
};

export default function GovernanceBar({ refreshKey }: { refreshKey?: number }) {
  const [s, setS] = useState<State | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/governance", { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (active && j?.phase) setS(j as State);
      } catch {}
    })();
    return () => { active = false; };
  }, [refreshKey]);

  if (!s) return null;

  const pct = s.decentralizeAt > 0 ? Math.min(100, Math.round((s.participantCount / s.decentralizeAt) * 100)) : 0;
  const isDecentralized = s.phase === "decentralized";

  return (
    <div
      className="text-[11px] flex items-center gap-2 px-3 py-1 border-b border-gray-200/60 bg-gray-50"
      title="nightwish 거버넌스 — 참여자가 임계에 도달하면 규칙 변경권이 단일 관리자에서 합의체로 자동 이전됩니다 (constitutional pre-commitment)."
    >
      <span className={`px-1.5 py-0.5 rounded ${isDecentralized ? "bg-emerald-100 text-emerald-800 border border-emerald-300" : "bg-amber-100 text-amber-800 border border-amber-300"}`}>
        {isDecentralized ? "DECENTRALIZED" : "BOOTSTRAP"}
      </span>
      {!isDecentralized ? (
        <>
          <span className="text-gray-600">참여자 {s.participantCount}/{s.decentralizeAt}</span>
          <div className="flex-1 max-w-[160px] h-1.5 rounded bg-gray-200 overflow-hidden">
            <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-gray-500">분권까지 {s.remainingToDecentralize}명</span>
        </>
      ) : (
        <span className="text-gray-600">합의체 {s.councilSize}명 · 정족수 {s.councilQuorumPct}%</span>
      )}
      {s.adminEmail && <span className="ml-auto text-gray-400">admin: {s.adminEmail}</span>}
    </div>
  );
}
