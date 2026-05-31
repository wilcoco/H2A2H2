"use client";

import React, { useEffect, useMemo, useState } from "react";
import DecayCurve from "@/components/DecayCurve";

type MyQAItem = {
  id: string;
  question: string;
  summary?: string;
  rootId?: string;
  createdAt: string;
  helpful: number;
  unhelpful: number;
};

type MyStakeItem = {
  id: string;
  rootId: string;
  qaId?: string;
  amount: number;
  lockDays: number;
  createdAt: string;
  lockUntil: string;
  rootQuestion?: string;
  helpful: number;
  unhelpful: number;
  qualityScore: number;
};

type MyYieldItem = {
  stakeId: string;
  rootId: string;
  qaId?: string;
  amount: number;
  lockDays: number;
  createdAt: string;
  lockUntil: string;
  rootQuestion?: string;
  helpful: number;
  unhelpful: number;
  qualityScore: number;
  estimatedYield: number;
  // nightwish 게이트/시간붕괴
  ageDays?: number;
  decayFactor?: number;
  branchVerified?: boolean;
  eligible?: boolean;
  gateReason?: "ok" | "branch_not_verified" | "self_stake" | "reclaimed" | "no_contribution";
  lastContributionAt?: string;
};

export default function MePage() {
  const [loading, setLoading] = useState(true);
  const [qa, setQa] = useState<MyQAItem[]>([]);
  const [stakes, setStakes] = useState<MyStakeItem[]>([]);
  const [yields, setYields] = useState<MyYieldItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [q, setQ] = useState("");
  const [qaSearch, setQaSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "matured">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [sortKey, setSortKey] = useState<"maturity_asc" | "created_desc" | "created_asc" | "amount_desc" | "yield_desc">("maturity_asc");

  // naive auth check by attempting to fetch my Q/A
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setAuthChecking(true);
      try {
        const r = await fetch("/api/qa/my?limit=1", { credentials: "include" });
        const j = await r.json();
        if (!cancelled) {
          setIsAuthed(Array.isArray(j.items));
        }
      } catch {
        if (!cancelled) setIsAuthed(false);
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [qaRes, stakeRes, yieldRes] = await Promise.all([
          fetch("/api/qa/my?limit=100", { credentials: "include" }),
          fetch("/api/qa/stake/my?limit=100", { credentials: "include" }),
          fetch("/api/qa/stake/yield/my", { credentials: "include" }),
        ]);
        const [qaJson, stakeJson, yieldJson] = await Promise.all([
          qaRes.json(),
          stakeRes.json(),
          yieldRes.json(),
        ]);
        if (!cancelled) {
          setQa(Array.isArray(qaJson.items) ? qaJson.items : []);
          setStakes(Array.isArray(stakeJson.items) ? stakeJson.items : []);
          setYields(Array.isArray(yieldJson.items) ? yieldJson.items : []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (isAuthed) load();
    else {
      setQa([]); setStakes([]); setYields([]); setLoading(false);
    }
    return () => { cancelled = true; };
  }, [isAuthed]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });
      if (r.ok) {
        window.location.reload();
      }
    } catch {}
  }

  const nowMs = Date.now();
  const activeStakes = stakes.filter((s) => new Date(s.lockUntil).getTime() > nowMs);
  const activeTotal = activeStakes.reduce((sum, s) => sum + (s.amount || 0), 0);
  const nextMaturityTs = activeStakes.length > 0 ? Math.min(...activeStakes.map((s) => new Date(s.lockUntil).getTime())) : null;
  const nextMaturity = nextMaturityTs ? new Date(nextMaturityTs).toLocaleString() : null;
  const yieldTotal = yields.reduce((sum, y) => sum + (y.estimatedYield || 0), 0);
  const filteredQa = useMemo(() => {
    const ql = qaSearch.trim().toLowerCase();
    if (!ql) return qa;
    return qa.filter((x) => {
      const s1 = (x.question || "").toLowerCase();
      const s2 = (x.summary || "").toLowerCase();
      const s3 = (x.rootId || "").toLowerCase();
      return s1.includes(ql) || s2.includes(ql) || s3.includes(ql);
    });
  }, [qa, qaSearch]);

  const combinedItems = useMemo(() => {
    const yMap = new Map(yields.map((y) => [y.stakeId, y] as const));
    return stakes.map((s) => {
      const y = yMap.get(s.id);
      const matured = new Date(s.lockUntil).getTime() <= nowMs;
      return {
        id: s.id,
        rootId: s.rootId,
        rootQuestion: s.rootQuestion,
        amount: s.amount,
        lockDays: s.lockDays,
        createdAt: s.createdAt,
        lockUntil: s.lockUntil,
        helpful: s.helpful,
        unhelpful: s.unhelpful,
        qualityScore: s.qualityScore,
        estimatedYield: y?.estimatedYield ?? 0,
        status: matured ? "matured" : "active",
      } as const;
    });
  }, [stakes, yields]);

  const filteredCombined = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? (new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1) : null;
    const minAmt = amountMin ? Number(amountMin) : null;
    const maxAmt = amountMax ? Number(amountMax) : null;
    let arr = combinedItems.filter((it) => {
      if (statusFilter !== "all" && it.status !== statusFilter) return false;
      if (ql) {
        const s1 = (it.rootQuestion || "").toLowerCase();
        const s2 = (it.rootId || "").toLowerCase();
        if (!s1.includes(ql) && !s2.includes(ql)) return false;
      }
      const cts = new Date(it.createdAt).getTime();
      if (fromTs && cts < fromTs) return false;
      if (toTs && cts > toTs) return false;
      if (minAmt != null && !Number.isNaN(minAmt) && it.amount < minAmt) return false;
      if (maxAmt != null && !Number.isNaN(maxAmt) && it.amount > maxAmt) return false;
      return true;
    });
    if (sortKey === "maturity_asc") arr = arr.sort((a, b) => new Date(a.lockUntil).getTime() - new Date(b.lockUntil).getTime());
    else if (sortKey === "created_desc") arr = arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    else if (sortKey === "created_asc") arr = arr.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    else if (sortKey === "amount_desc") arr = arr.sort((a, b) => b.amount - a.amount);
    else if (sortKey === "yield_desc") arr = arr.sort((a, b) => (b.estimatedYield || 0) - (a.estimatedYield || 0));
    return arr;
  }, [combinedItems, q, statusFilter, dateFrom, dateTo, amountMin, amountMax, sortKey]);

  const monthlyPerf = useMemo(() => {
    const m = new Map<string, number>();
    for (const y of yields) {
      const dt = new Date(y.lockUntil);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      m.set(key, (m.get(key) || 0) + (y.estimatedYield || 0));
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [yields]);

  function exportCsv() {
    const header = ["stake_id","status","root_id","root_question","amount","lock_days","created_at","lock_until","helpful","unhelpful","quality","estimated_yield"];
    const rows = filteredCombined.map((r) => [
      r.id,
      r.status,
      r.rootId,
      (r.rootQuestion || "").replace(/\n/g, " "),
      String(r.amount),
      String(r.lockDays),
      new Date(r.createdAt).toISOString(),
      new Date(r.lockUntil).toISOString(),
      String(r.helpful ?? 0),
      String(r.unhelpful ?? 0),
      String(r.qualityScore ?? 0),
      String(r.estimatedYield ?? 0),
    ]);
    const csv = [header, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stakes_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">내 페이지</h1>
        <div className="flex items-center gap-2">
          <a href="/" className="text-xs px-2 py-1 rounded border hover:bg-gray-100">메인으로</a>
          <a href="/me/chains" className="text-xs px-2 py-1 rounded border hover:bg-gray-100">나의 체인</a>
        </div>
      </div>

      {!authChecking && !isAuthed && (
        <div className="mb-8 p-4 rounded border">
          <h2 className="font-medium mb-2">로그인</h2>
          <form onSubmit={onLogin} className="flex flex-col gap-2 max-w-md">
            <input className="border rounded p-2" placeholder="이메일" value={email} onChange={(e)=>setEmail(e.target.value)} />
            <input className="border rounded p-2" placeholder="이름(선택)" value={name} onChange={(e)=>setName(e.target.value)} />
            <button className="bg-blue-600 text-white rounded px-4 py-2" type="submit">로그인</button>
          </form>
        </div>
      )}

      {isAuthed && (
        <>
          

          <div className="mt-8 mb-2 pt-4 border-t">
            <h2 className="text-lg font-semibold">예치/락업</h2>
          </div>

          <section className="mb-8">
            <h2 className="font-medium mb-2">나의 락업 현황</h2>
            {loading ? (
              <div>불러오는 중…</div>
            ) : (
              <div className="p-3 rounded border flex flex-col gap-1 text-sm">
                <div>진행 중 {activeStakes.length}건 · 총 예치 {activeTotal} 크레딧</div>
                <div>다음 만기 {nextMaturity ? nextMaturity : "-"}</div>
                <div>누적 성과 {yieldTotal}</div>
              </div>
            )}
          </section>

          <section className="mb-8">
            <h2 className="font-medium mb-2">나의 예치 목록</h2>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <input className="border rounded px-2 py-1" placeholder="검색(질문/루트ID)" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="border rounded px-2 py-1" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
                <option value="all">전체</option>
                <option value="active">진행</option>
                <option value="matured">만기</option>
              </select>
              <input type="date" className="border rounded px-2 py-1" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <span>~</span>
              <input type="date" className="border rounded px-2 py-1" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              <input type="number" className="border rounded px-2 py-1 w-28" placeholder="금액 최소" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
              <input type="number" className="border rounded px-2 py-1 w-28" placeholder="금액 최대" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
              <select className="border rounded px-2 py-1" value={sortKey} onChange={(e) => setSortKey(e.target.value as any)}>
                <option value="maturity_asc">가까운 만기</option>
                <option value="created_desc">최신 생성</option>
                <option value="created_asc">오래된 생성</option>
                <option value="amount_desc">금액 큰 순</option>
                <option value="yield_desc">성과 큰 순</option>
              </select>
              <button className="border rounded px-2 py-1" onClick={exportCsv}>CSV 내보내기</button>
            </div>
            {loading ? (
              <div>불러오는 중…</div>
            ) : filteredCombined.length === 0 ? (
              <div className="text-gray-500">조건에 해당하는 항목이 없습니다.</div>
            ) : (
              <ul className="space-y-2">
                {filteredCombined.map((s) => (
                  <li key={s.id} className="p-3 rounded border">
                    <div className="flex items-center justify-between">
                      <div className="font-medium truncate mr-4">{s.rootQuestion ?? s.rootId}</div>
                      <div className="text-sm">+{s.amount} 크레딧</div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">상태 {s.status === 'active' ? '진행' : '만기'} · 락업 {s.lockDays}일 · {new Date(s.createdAt).toLocaleString()} → 만기 {new Date(s.lockUntil).toLocaleDateString()}</div>
                    <div className="text-xs text-gray-500 mt-1">품질지표: 도움됨 {s.helpful} · 비도움 {s.unhelpful} · 점수 {(s.qualityScore*100).toFixed(0)}%</div>
                    {s.status === 'matured' && (
                      <div className="text-xs text-emerald-700 mt-1">성과 {s.estimatedYield}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mb-8">
            <h2 className="font-medium mb-2">월별 성과</h2>
            {monthlyPerf.length === 0 ? (
              <div className="text-gray-500">표시할 데이터가 없습니다.</div>
            ) : (
              <div className="flex items-end gap-2 h-36">
                {(() => {
                  const maxV = Math.max(1, ...monthlyPerf.map(([, v]) => v));
                  return monthlyPerf.map(([k, v]) => (
                    <div key={k} className="flex flex-col items-center">
                      <div className="bg-blue-500 w-8" style={{ height: `${Math.round((v / maxV) * 100)}%` }} />
                      <div className="text-[10px] mt-1 text-gray-600">{k}</div>
                      <div className="text-[10px] text-gray-700">{v}</div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </section>

          <section>
            <h2 className="font-medium mb-2">만기/결과 내역</h2>
            {loading ? (
              <div>불러오는 중…</div>
            ) : yields.length === 0 ? (
              <div className="text-gray-500">만기된 예치가 없습니다.</div>
            ) : (
              <ul className="space-y-2">
                {yields.map((y) => (
                  <li key={y.stakeId} className="p-3 rounded border">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium truncate mr-4">{y.rootQuestion ?? y.rootId}</div>
                      <div className="text-sm">예치 {y.amount} → 추정 성과 {y.estimatedYield}</div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-2">
                      <span>만기 {new Date(y.lockUntil).toLocaleString()}</span>
                      <span>· 품질 {(y.qualityScore*100).toFixed(0)}%</span>
                      {typeof y.branchVerified === "boolean" && (
                        <span className={y.branchVerified ? "text-emerald-700" : "text-amber-700"}>
                          {y.branchVerified ? "✓ 검증됨" : "⚠ 미검증"}
                        </span>
                      )}
                      {y.gateReason && y.gateReason !== "ok" && (
                        <span className="text-red-600" title="이 답이 지금 보상을 못 받는 이유">
                          {y.gateReason === "branch_not_verified" && "보상 잠금: 이 답이 실측 결과로 확인되지 않음"}
                          {y.gateReason === "self_stake" && "보상 잠금: 본인이 만든 답에는 자기 응원 안 됨"}
                          {y.gateReason === "reclaimed" && "보상 잠금: 포인트가 공용 풀로 회수됨"}
                          {y.gateReason === "no_contribution" && "보상 잠금: 이 답에 기여(👍·노트·검증)가 없음"}
                        </span>
                      )}
                      {typeof y.decayFactor === "number" && (
                        <span title={`age ${y.ageDays}일, 반감기 30일`}>· decay ×{y.decayFactor}</span>
                      )}
                    </div>
                    {typeof y.ageDays === "number" && (
                      <div className="mt-2 flex items-center gap-3">
                        <DecayCurve ageDays={y.ageDays} halfLifeDays={30} />
                        <div className="text-[11px] text-gray-500">
                          기여하면 age가 리셋되어 곡선이 0으로 돌아갑니다.<br/>
                          (피드백·노트·검증·관계 작성 시 자동 리셋)
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-8 mb-2 pt-4 border-t">
            <h2 className="text-lg font-semibold">체인 정보</h2>
          </div>
          <section className="mb-8">
            <h2 className="font-medium mb-2">나의 질문/답변 기록</h2>
            <div className="mb-2 text-xs">
              <input className="border rounded px-2 py-1" placeholder="검색(질문/요약/루트ID)" value={qaSearch} onChange={(e) => setQaSearch(e.target.value)} />
            </div>
            {loading ? (
              <div>불러오는 중…</div>
            ) : filteredQa.length === 0 ? (
              <div className="text-gray-500">조건에 해당하는 항목이 없습니다.</div>
            ) : (
              <ul className="space-y-2">
                {filteredQa.map((x) => (
                  <li key={x.id} className="p-3 rounded border">
                    <div className="text-sm text-gray-500">{new Date(x.createdAt).toLocaleString()}</div>
                    <div className="font-medium">{x.question}</div>
                    {x.summary && <div className="text-sm text-gray-600 mt-1">{x.summary}</div>}
                    <div className="text-xs text-gray-500 mt-1">도움됨 {x.helpful} · 비도움 {x.unhelpful}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {error && <div className="text-red-600 mt-4">{error}</div>}
    </div>
  );
}
