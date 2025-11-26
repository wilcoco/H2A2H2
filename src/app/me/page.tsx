"use client";

import React, { useEffect, useState } from "react";

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

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">내 페이지</h1>
        <a href="/me/chains" className="text-xs px-2 py-1 rounded border hover:bg-gray-100">나의 체인</a>
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
          <section className="mb-8">
            <h2 className="font-medium mb-2">나의 질문/답변 기록</h2>
            {loading ? (
              <div>불러오는 중…</div>
            ) : qa.length === 0 ? (
              <div className="text-gray-500">기록이 없습니다.</div>
            ) : (
              <ul className="space-y-2">
                {qa.map((x) => (
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

          <section className="mb-8">
            <h2 className="font-medium mb-2">나의 투자(예치) 기록</h2>
            {loading ? (
              <div>불러오는 중…</div>
            ) : stakes.length === 0 ? (
              <div className="text-gray-500">예치 기록이 없습니다.</div>
            ) : (
              <ul className="space-y-2">
                {stakes.map((s) => (
                  <li key={s.id} className="p-3 rounded border">
                    <div className="flex items-center justify-between">
                      <div className="font-medium truncate mr-4">{s.rootQuestion ?? s.rootId}</div>
                      <div className="text-sm">+{s.amount} 크레딧</div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">락업 {s.lockDays}일 · {new Date(s.createdAt).toLocaleString()} → 만기 {new Date(s.lockUntil).toLocaleDateString()}</div>
                    <div className="text-xs text-gray-500 mt-1">품질지표: 도움됨 {s.helpful} · 비도움 {s.unhelpful} · 점수 {(s.qualityScore*100).toFixed(0)}%</div>
                  </li>
                ))}
              </ul>
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
                    <div className="flex items-center justify-between">
                      <div className="font-medium truncate mr-4">{y.rootQuestion ?? y.rootId}</div>
                      <div className="text-sm">예치 {y.amount} → 추정 성과 {y.estimatedYield}</div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">만기 {new Date(y.lockUntil).toLocaleString()} · 품질 {(y.qualityScore*100).toFixed(0)}%</div>
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
