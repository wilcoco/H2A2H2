// nightwish/economy.py 포팅 — 시간붕괴 배당 + 부가가치 게이트 + 잠복 회수 + 부활 복원
// critique §1.1(제로섬·외부 닻) / §1.2(인플레-잠금 딜레마) / §1.3(자본 자기증식 차단)

export interface StakeLike {
  id: string;
  userId: string;
  qaId: string | null;
  qaRootId: string;
  amount: number;
  createdAt: Date;
  lockUntil: Date;
  lastContributionAt: Date;
  isSelf: boolean;
  isReclaimed: boolean;
}

export interface YieldOptions {
  pool?: number;                  // 배당 풀 (없으면 amount 합의 dividend_rate 비율 사용)
  dividendRate?: number;          // 기본 0.20
  halfLifeDays?: number;          // 기본 30
  isBranchVerified: boolean;      // verification.py 게이트 — false면 0 배당
  hasContribution: (userId: string) => boolean; // 부가가치 게이트 — 빈손 우회
  now?: Date;
}

export function timeDecay(stake: StakeLike, halfLifeDays: number, now: Date): number {
  const ageMs = now.getTime() - stake.lastContributionAt.getTime();
  const ageDays = Math.max(0, ageMs / 86400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function effectiveWeight(stake: StakeLike, halfLifeDays: number, now: Date): number {
  return stake.amount * timeDecay(stake, halfLifeDays, now);
}

// 한 root_id 가지(체인)의 stakes에 대해 시간붕괴·부가가치 게이트·검증 게이트를
// 모두 적용한 사용자별 배당. 검증 안 된 가지는 무조건 0 (구조적 폰지 차단).
export function distributeDividend(
  stakes: StakeLike[],
  opts: YieldOptions
): Record<string, number> {
  if (!opts.isBranchVerified) return {};
  const now = opts.now ?? new Date();
  const halfLife = opts.halfLifeDays ?? 30;
  const dividendRate = opts.dividendRate ?? 0.20;

  const eligible = stakes.filter((s) => !s.isSelf && !s.isReclaimed && opts.hasContribution(s.userId));
  if (eligible.length === 0) return {};

  const totalFresh = stakes.reduce((a, s) => a + s.amount, 0);
  const pool = opts.pool ?? totalFresh * dividendRate;
  if (pool <= 0) return {};

  // earliness × time-decay: 오래된(early) 스테이크가 발견 보상으로 큰 가중
  // 단, 갱신 안 된 스테이크는 시간붕괴로 0 수렴 → 자본만의 자기증식 차단
  const sorted = [...eligible].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const weights: Record<string, number> = {};
  sorted.forEach((s, i) => {
    const earliness = sorted.length - i; // 가장 이른 자가 가장 큰 가중
    const decay = timeDecay(s, halfLife, now);
    const w = earliness * s.amount * decay;
    weights[s.userId] = (weights[s.userId] ?? 0) + w;
  });

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total <= 0) return {};

  const out: Record<string, number> = {};
  for (const [userId, w] of Object.entries(weights)) {
    out[userId] = (pool * w) / total;
  }
  return out;
}

// 잠복 가지(dormant) 회수: 소각하지 않고 유동성 풀로 환원.
// 부활 시 원 스테이커 복원 + 발견자 보너스 (가지는 살리되 유동성은 마르지 않게).
export function reclaimAmount(stakes: StakeLike[]): number {
  return stakes.filter((s) => !s.isReclaimed).reduce((a, s) => a + s.amount, 0);
}

export function discoveryBonus(reclaimedAmount: number, bonusRate = 0.10): number {
  return reclaimedAmount * bonusRate;
}
