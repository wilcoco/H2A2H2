"use client";

import { useEffect, useState } from "react";

type Props = { qaId?: string; rootId?: string; refreshKey?: number };

type Item = {
  id: string;
  metric: string;
  baseline: number;
  observed: number;
  unit?: string | null;
  direction: "higher_better" | "lower_better";
  passes: boolean;
  source_url?: string | null;
  created_at: string;
};

export default function VerificationBadge({ qaId, rootId, refreshKey }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [branchVerified, setBranchVerified] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!qaId && !rootId) { setItems([]); setBranchVerified(false); return; }
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const params = rootId ? `rootId=${encodeURIComponent(rootId)}` : `qaId=${encodeURIComponent(qaId!)}`;
        const r = await fetch(`/api/qa/verify?${params}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!active) return;
        setItems(Array.isArray(j?.items) ? j.items : []);
        setBranchVerified(Boolean(j?.branchVerified));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [qaId, rootId, refreshKey]);

  if (!qaId && !rootId) return null;

  if (loading && items.length === 0) {
    return <span className="text-[10px] text-gray-400">검증 확인 중…</span>;
  }

  if (items.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-800"
        title="이 가지에는 외부 현실 측정이 없습니다. 검증 닻이 없으면 배당이 0으로 잠깁니다 (nightwish critique §2)."
      >
        ⚠ 미검증
      </span>
    );
  }

  const passed = items.filter((it) => it.passes);
  const failed = items.length - passed.length;
  const best = passed[0];

  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      {branchVerified ? (
        <span
          className="px-2 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-800"
          title={`검증된 가지 — 배당 게이트 통과. 통과 ${passed.length}건 / 실패 ${failed}건.`}
        >
          ✓ 검증됨
          {best && (
            <span className="ml-1 text-emerald-700/80">
              · {best.metric} {fmt(best.baseline, best.unit)}→{fmt(best.observed, best.unit)}
            </span>
          )}
        </span>
      ) : (
        <span
          className="px-2 py-0.5 rounded border border-red-300 bg-red-50 text-red-800"
          title={`측정은 있으나 통과 없음 (${failed}건 실패).`}
        >
          ✗ 측정 실패
        </span>
      )}
    </span>
  );
}

function fmt(v: number, unit?: string | null): string {
  const u = unit || "";
  if (Math.abs(v) >= 100) return `${v.toFixed(0)}${u}`;
  if (Math.abs(v) >= 10) return `${v.toFixed(1)}${u}`;
  return `${v.toFixed(2)}${u}`;
}
