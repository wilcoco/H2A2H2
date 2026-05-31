"use client";

import { useEffect, useState } from "react";
import SybilFlagsPanel from "./SybilFlagsPanel";

type Member = { email: string; seated_at: string };
type LogEntry = { at: string; actor: string | null; kind: string; detail: string | null };
type State = {
  phase: "bootstrap" | "decentralized";
  adminEmail: string | null;
  decentralizeAt: number;
  councilQuorumPct: number;
  participantCount: number;
  councilSize: number;
  remainingToDecentralize: number;
  council: Member[];
  log: LogEntry[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  currentUserEmail?: string;
  refreshKey?: number;
  onChanged?: () => void;
};

export default function GovernanceCouncilModal({ open, onClose, currentUserEmail, refreshKey, onChanged }: Props) {
  const [s, setS] = useState<State | null>(null);
  const [loading, setLoading] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [approvalsRaw, setApprovalsRaw] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch("/api/governance", { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (active && j?.phase) setS(j as State);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [open, tick, refreshKey]);

  if (!open) return null;

  const isAdmin = Boolean(s && currentUserEmail && s.adminEmail && currentUserEmail === s.adminEmail);
  const isDecentralized = s?.phase === "decentralized";
  const canChange = isDecentralized
    ? true /* 합의체 과반 승인 필요 */
    : isAdmin;

  async function seat() {
    if (!newEmail.trim()) return;
    setBusy("seat");
    setMsg(null);
    try {
      const approvals = approvalsRaw.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      const r = await fetch("/api/governance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seat_council", member: newEmail.trim(), approvals }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || "추가 실패"); return; }
      setMsg(`추가: ${newEmail}`);
      setNewEmail("");
      setTick((n) => n + 1);
      onChanged?.();
    } finally { setBusy(null); }
  }

  async function remove(email: string) {
    setBusy(`rm:${email}`);
    setMsg(null);
    try {
      const approvals = approvalsRaw.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      const r = await fetch("/api/governance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_council", member: email, approvals }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || "제거 실패"); return; }
      setMsg(`제거: ${email}`);
      setTick((n) => n + 1);
      onChanged?.();
    } finally { setBusy(null); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onMouseDown={onClose}>
      <div className="bg-white text-gray-900 rounded shadow-lg w-[min(720px,94vw)] max-h-[88vh] overflow-auto p-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="text-sm font-semibold">거버넌스 — 합의체</div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {isDecentralized
                ? "분권 단계: 변경은 합의체 과반 승인이 필요합니다. 아래 'approvals' 입력란에 동의한 의원 이메일을 콤마/공백 구분으로 넣으세요."
                : "부트스트랩 단계: admin만 변경 가능. 참여자가 임계에 도달하면 자동으로 분권됩니다."}
            </div>
          </div>
          <button className="text-xs px-2 py-1 rounded border" onClick={onClose}>닫기</button>
        </div>

        {loading || !s ? <div className="text-xs text-gray-500">로딩 중…</div> : (
          <>
            <div className="grid grid-cols-2 gap-2 text-[11px] mb-3 p-2 bg-gray-50 rounded border">
              <div>Phase: <strong>{s.phase}</strong></div>
              <div>Admin: <code className="text-[11px]">{s.adminEmail || "(none)"}</code></div>
              <div>참여자: {s.participantCount} / {s.decentralizeAt}</div>
              <div>합의체: {s.councilSize}명 (정족수 {s.councilQuorumPct}%)</div>
            </div>

            <div className="mb-3">
              <div className="text-xs font-medium mb-1">현재 합의체</div>
              {s.council.length === 0 ? (
                <div className="text-[11px] text-gray-400">아직 의원 없음</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {s.council.map((m) => (
                    <li key={m.email} className="text-[11px] flex items-center gap-2 border rounded px-2 py-1">
                      <code className="text-[11px]">{m.email}</code>
                      <span className="text-gray-400">since {new Date(m.seated_at).toLocaleDateString()}</span>
                      <button
                        className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                        onClick={() => remove(m.email)}
                        disabled={!canChange || busy === `rm:${m.email}`}
                      >제거</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mb-3 border rounded p-2">
              <div className="text-xs font-medium mb-1">의원 추가</div>
              <div className="flex flex-col gap-1.5">
                <input
                  type="email"
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder="email@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
                {isDecentralized && (
                  <input
                    className="w-full border rounded px-2 py-1 text-sm"
                    placeholder="approvals (콤마/공백 구분, 의원 이메일들)"
                    value={approvalsRaw}
                    onChange={(e) => setApprovalsRaw(e.target.value)}
                  />
                )}
                <button
                  className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 self-end"
                  onClick={seat}
                  disabled={!canChange || busy === "seat" || !newEmail.trim()}
                >{busy === "seat" ? "추가 중…" : "추가"}</button>
              </div>
            </div>

            {msg && <div className="text-[12px] text-gray-700 mb-3">{msg}</div>}

            <div className="mb-3 border-t pt-3">
              <SybilFlagsPanel isAdmin={isAdmin} refreshKey={tick} />
            </div>

            <div>
              <div className="text-xs font-medium mb-1">최근 거버넌스 로그</div>
              {s.log.length === 0 ? (
                <div className="text-[11px] text-gray-400">기록 없음</div>
              ) : (
                <ul className="flex flex-col gap-0.5 max-h-48 overflow-auto">
                  {s.log.map((l, i) => (
                    <li key={i} className="text-[11px] text-gray-700 flex items-center gap-2">
                      <span className="text-gray-400 w-32 shrink-0">{new Date(l.at).toLocaleString()}</span>
                      <span className="font-medium">{l.kind}</span>
                      <span className="text-gray-500">{l.actor || "(system)"}</span>
                      <span className="truncate">{l.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
