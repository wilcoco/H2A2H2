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

type Props = {
  refreshKey?: number;
  currentUserEmail?: string;
  onOpenCouncil?: () => void;
  onSeededP0?: (qaId: string) => void;
};

export default function GovernanceBar({ refreshKey, currentUserEmail, onOpenCouncil, onSeededP0 }: Props) {
  const [s, setS] = useState<State | null>(null);
  const [seeded, setSeeded] = useState<boolean | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/governance", { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (active && j?.phase) setS(j as State);
      } catch {}
      try {
        const r2 = await fetch("/api/admin/seed/p0", { cache: "no-store" });
        const j2 = await r2.json().catch(() => null);
        if (active && j2) setSeeded(Boolean(j2.seeded));
      } catch {}
    })();
    return () => { active = false; };
  }, [refreshKey]);

  async function seedP0() {
    setSeedBusy(true);
    setSeedMsg(null);
    try {
      const r = await fetch("/api/admin/seed/p0", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setSeedMsg(j?.error || "시드 실패"); return; }
      setSeeded(true);
      setSeedMsg(j.alreadySeeded ? "이미 시드됨" : `시드 완료: ${j.qaId}`);
      if (!j.alreadySeeded && j.qaId) onSeededP0?.(j.qaId);
    } finally {
      setSeedBusy(false);
    }
  }

  if (!s) return null;
  const isAdmin = Boolean(currentUserEmail && s.adminEmail && currentUserEmail === s.adminEmail);

  const pct = s.decentralizeAt > 0 ? Math.min(100, Math.round((s.participantCount / s.decentralizeAt) * 100)) : 0;
  const isDecentralized = s.phase === "decentralized";

  return (
    <div
      className="text-[11px] flex items-center gap-2 px-3 py-1 border-b border-gray-200/60 bg-gray-50"
      title="nightwish 거버넌스 — 참여자가 임계에 도달하면 규칙 변경권이 단일 관리자에서 합의체로 자동 이전됩니다 (constitutional pre-commitment)."
    >
      <span className={`px-1.5 py-0.5 rounded ${isDecentralized ? "bg-emerald-100 text-emerald-800 border border-emerald-300" : "bg-amber-100 text-amber-800 border border-amber-300"}`}>
        {isDecentralized ? "공동 운영" : "초기 단계"}
      </span>
      {!isDecentralized ? (
        <>
          <span className="text-gray-600">참여자 {s.participantCount}/{s.decentralizeAt}</span>
          <div className="flex-1 max-w-[160px] h-1.5 rounded bg-gray-200 overflow-hidden">
            <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-gray-500">공동 운영까지 {s.remainingToDecentralize}명</span>
        </>
      ) : (
        <span className="text-gray-600">운영진 {s.councilSize}명 · 결정 정족수 {s.councilQuorumPct}%</span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {isAdmin && (
          <button
            className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-300 bg-white hover:bg-emerald-50 disabled:opacity-50"
            onClick={seedP0}
            disabled={seedBusy || seeded === true}
            title="외부 현실 닻 데모 — 사출 웰드라인 불량률 8→2% 시드"
          >{seeded ? "P0 시드됨" : seedBusy ? "시드 중…" : "+ P0 시드"}</button>
        )}
        {seedMsg && <span className="text-gray-500">{seedMsg}</span>}
        <button
          className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-50"
          onClick={onOpenCouncil}
          title="운영진 구성·관리"
        >운영진</button>
        {s.adminEmail && <span className="text-gray-400">admin: {s.adminEmail}</span>}
      </div>
    </div>
  );
}
