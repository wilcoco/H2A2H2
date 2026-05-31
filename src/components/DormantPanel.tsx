"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  question: string;
  summary: string | null;
  createdAt: string;
  createdBy: string | null;
  rootId: string;
  lastActivity: string;
  liveStake: number;
};

type Props = {
  onSelect?: (qaId: string) => void;
  refreshKey?: number;
};

export default function DormantPanel({ onSelect, refreshKey }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dormantDays, setDormantDays] = useState<number>(30);
  const [msg, setMsg] = useState<string | null>(null);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/qa/dormant", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!active) return;
        setItems(Array.isArray(j?.items) ? j.items : []);
        if (typeof j?.dormantDays === "number") setDormantDays(j.dormantDays);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [bump, refreshKey]);

  async function act(action: "reclaim" | "revive", qaId: string) {
    setBusy(qaId + ":" + action);
    setMsg(null);
    try {
      const r = await fetch("/api/qa/dormant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, qaId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || `${action} 실패`); return; }
      if (action === "reclaim") setMsg(`회수 ${Math.round(j.reclaimed || 0)}pt → 유동성 풀`);
      else setMsg(`부활: 복원 ${Math.round(j.restored || 0)}pt, 발견 보너스 ${Math.round(j.bonus || 0)}pt`);
      setBump((n) => n + 1);
    } catch {
      setMsg(`${action} 실패`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-600">잠복 가지 (≥{dormantDays}일 무활동)</div>
        <button className="text-[10px] px-2 py-0.5 rounded border" onClick={() => setBump((n) => n + 1)} disabled={loading}>{loading ? "…" : "새로고침"}</button>
      </div>
      {msg && <div className="text-[11px] text-gray-700">{msg}</div>}
      {items.length === 0 && !loading && (
        <div className="text-[11px] text-gray-400">잠복 가지 없음. 갈릴레오 가지는 살아 있어도 잠시 잘 수 있어요.</div>
      )}
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <li key={it.id} className="rounded border border-gray-200 px-2 py-1.5 hover:bg-gray-50">
            <button
              className="text-left block w-full text-[12px] font-medium text-gray-800 line-clamp-2"
              onClick={() => onSelect?.(it.id)}
              title={it.question}
            >{it.question}</button>
            {it.summary && <div className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{it.summary}</div>}
            <div className="text-[10px] text-gray-400 mt-0.5">
              {it.createdBy || "anon"} · stake {it.liveStake}pt · 마지막 {fmtDate(it.lastActivity)}
            </div>
            <div className="flex items-center gap-1 mt-1">
              <button
                className="text-[10px] px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                onClick={() => act("reclaim", it.id)}
                disabled={busy === it.id + ":reclaim" || it.liveStake <= 0}
                title="라이브 스테이크를 유동성 풀로 환원합니다 (소각 아님)"
              >회수</button>
              <button
                className="text-[10px] px-2 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                onClick={() => act("revive", it.id)}
                disabled={busy === it.id + ":revive"}
                title="부활: 원 스테이커 복원 + 발견자 보너스"
              >부활</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmtDate(s: string): string {
  try {
    const d = new Date(s);
    const days = Math.floor((Date.now() - d.getTime()) / 86400_000);
    if (days < 1) return "오늘";
    if (days < 30) return `${days}일 전`;
    if (days < 365) return `${Math.floor(days / 30)}달 전`;
    return `${Math.floor(days / 365)}년 전`;
  } catch { return s; }
}
