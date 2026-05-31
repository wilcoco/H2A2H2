// nightwish/governance.py 포팅 — 거버넌스 사전공약
// critique §3 — "권력이 가장 집중된 시점이 통제 장치가 가장 없는 시점이다."
// 분권을 *발행 규칙에 미리 박아둠*: N명 도달 시 단일 관리자 → 합의체로 자동 이전.

export type Phase = "bootstrap" | "decentralized";

export interface GovernanceState {
  phase: Phase;
  adminEmail: string | null;
  decentralizeAt: number;
  councilQuorumPct: number;       // 0-100
  participantCount: number;
}

export function shouldAutoTransition(s: GovernanceState): boolean {
  return s.phase === "bootstrap" && s.participantCount >= s.decentralizeAt;
}

export interface RuleChangeRequest {
  byEmail: string;
  approvals: string[];            // 합의체 멤버 이메일들 (분권 단계에서만 의미)
}

export function canChangeRule(
  s: GovernanceState,
  req: RuleChangeRequest,
  councilSize: number
): { ok: true } | { ok: false; reason: string } {
  if (s.phase === "bootstrap") {
    if (!s.adminEmail) return { ok: false, reason: "no admin seated" };
    if (req.byEmail !== s.adminEmail) return { ok: false, reason: "only admin in bootstrap" };
    return { ok: true };
  }
  // decentralized
  if (councilSize === 0) return { ok: false, reason: "no council seated" };
  const need = Math.ceil((s.councilQuorumPct / 100) * councilSize);
  if (req.approvals.length < need) {
    return { ok: false, reason: `quorum not met: ${req.approvals.length}/${councilSize} (need ${need})` };
  }
  return { ok: true };
}
