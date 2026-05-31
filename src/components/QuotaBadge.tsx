"use client";

import { useEffect, useState } from "react";

type Quota = {
  signedIn: boolean;
  freeUsedToday?: number;
  freeQuotaPerDay?: number;
  pointBalance?: number;
  byokProvider?: string | null;
  byokLabel?: string | null;
};

type Props = {
  refreshKey?: number;
  onOpenByok?: () => void;
};

export default function QuotaBadge({ refreshKey, onOpenByok }: Props) {
  const [q, setQ] = useState<Quota | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/user/quota", { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (active && j) setQ(j as Quota);
      } catch {}
    })();
    return () => { active = false; };
  }, [refreshKey]);

  if (!q || !q.signedIn) return null;

  const freeLeft = Math.max(0, (q.freeQuotaPerDay ?? 0) - (q.freeUsedToday ?? 0));
  const point = q.pointBalance ?? 0;
  const byok = Boolean(q.byokProvider);

  return (
    <button
      className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 flex items-center gap-1.5"
      onClick={onOpenByok}
      title="🆓 오늘 남은 무료 호출 · 🎫 포인트 잔액 · 🔑 본인 API 키 사용 여부. 클릭하면 키 설정."
    >
      <span className={freeLeft > 0 ? "text-emerald-700" : "text-gray-400"}>🆓 {freeLeft}/{q.freeQuotaPerDay ?? 0}</span>
      <span className={point > 0 ? "text-amber-700" : "text-gray-400"}>🎫 {point}</span>
      <span className={byok ? "text-violet-700" : "text-gray-400"}>🔑 {byok ? "ON" : "OFF"}</span>
    </button>
  );
}
