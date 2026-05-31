"use client";

import { useEffect, useState } from "react";

type Item = {
  user_id: string;
  peer_user_id: string;
  suspicion_score: number;
  reason: string;
  evidence: {
    jaccard?: number;
    syncFactor?: number;
    contributionDensity?: number;
    sharedPositiveCount?: number;
  } | null;
  computed_at: string;
};

type Props = {
  isAdmin: boolean;
  refreshKey?: number;
};

// 시빌/담합 의심 점수 패널. admin이 스캔 트리거 + 결과 리스트.
// critique §2: "공모된 빈손은 못 막는다" → 닻이 유일한 완전 차단.
// 이 패널은 *경고 시스템* (조치는 거버넌스가 결정).
export default function SybilFlagsPanel({ isAdmin, refreshKey }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch("/api/admin/sybil/scan", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (active) setItems(Array.isArray(j?.items) ? j.items : []);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [tick, refreshKey]);

  async function scan() {
    if (!isAdmin) { setMsg("admin 권한 필요"); return; }
    setScanning(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/sybil/scan", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || "스캔 실패"); return; }
      setMsg(`스캔 완료 — 사용자 ${j.usersAnalyzed}명, 의심 페어 ${j.signalsInserted}건`);
      setTick((n) => n + 1);
    } finally { setScanning(false); }
  }

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium">시빌/담합 의심 시그널</div>
        <button
          className="text-[10px] px-2 py-0.5 rounded border border-violet-300 hover:bg-violet-50 disabled:opacity-50"
          onClick={scan}
          disabled={scanning || !isAdmin}
          title={isAdmin ? "지금 다시 스캔" : "admin만 가능"}
        >{scanning ? "스캔 중…" : "재스캔"}</button>
      </div>
      <div className="text-[11px] text-gray-500 mb-2">
        외부 현실 닻이 없는 영역에서는 담합이 가능합니다(critique §2). 이 패널은 *경고*만 합니다 — 조치는 거버넌스가 결정.
      </div>
      {msg && <div className="text-[11px] text-gray-700 mb-2">{msg}</div>}
      {loading ? (
        <div className="text-[11px] text-gray-400">로딩…</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-gray-400">의심 페어 없음</div>
      ) : (
        <ul className="flex flex-col gap-1 max-h-72 overflow-auto">
          {items.map((it, i) => (
            <li key={i} className="border rounded px-2 py-1.5">
              <div className="flex items-center gap-2 text-[11px]">
                <span className={`px-1.5 py-0.5 rounded ${it.reason === "suspect" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{it.reason}</span>
                <span className="text-gray-500">score</span>
                <strong>{(it.suspicion_score * 100).toFixed(0)}%</strong>
              </div>
              <div className="text-[11px] text-gray-700 mt-0.5">
                <code className="text-[10px]">{it.user_id}</code> ↔ <code className="text-[10px]">{it.peer_user_id}</code>
              </div>
              {it.evidence && (
                <div className="text-[10px] text-gray-500 mt-0.5">
                  jaccard {it.evidence.jaccard} · sync {it.evidence.syncFactor} · density {it.evidence.contributionDensity} · shared+ {it.evidence.sharedPositiveCount}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
