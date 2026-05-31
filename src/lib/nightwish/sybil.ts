// 시빌/담합 탐지 — critique §2 후속
// "공모된 빈손은 못 막는다(critique §2). 외부 현실 닻이 유일한 완전 차단."
// 닻이 있어도 *경고 시스템*은 가치 있음 — 의심 점수를 거버넌스에 노출.
//
// 휴리스틱:
//  1) Jaccard overlap(user A의 +1 노드 vs user B의 +1 노드)이 임계 이상이고
//  2) A·B의 행동이 짧은 시간 윈도우(예: 1시간) 안에서 동기화되며
//  3) A·B 둘 다 기여 노드 수가 적고 stake도 미미함 → 의심
//
// 점수 = jaccard * sync_factor * (1 - contribution_density)
// 0~1 정규화. 0.7 이상 = 강한 의심.

export interface UserFeedbackVec {
  userId: string;
  positiveQaIds: Set<string>;          // 본인이 +1 한 qa_id 집합
  contributionCount: number;            // 본인이 작성한 entry/note/relation 합
  totalStake: number;                   // 본인 stake 합
  firstActiveAt: Date | null;
  lastActiveAt: Date | null;
}

export interface SuspicionEvidence {
  userA: string;
  userB: string;
  jaccard: number;
  syncFactor: number;
  contributionDensity: number;
  score: number;
  sharedPositiveCount: number;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni > 0 ? inter / uni : 0;
}

function timeOverlapFactor(a: UserFeedbackVec, b: UserFeedbackVec): number {
  // 두 사용자의 활동 구간이 얼마나 겹치는지 0~1.
  // 매우 단순화: 활동 구간이 비슷할수록 (시작/끝 일치) 1에 가까움.
  if (!a.firstActiveAt || !a.lastActiveAt || !b.firstActiveAt || !b.lastActiveAt) return 0.3;
  const aStart = a.firstActiveAt.getTime();
  const aEnd = a.lastActiveAt.getTime();
  const bStart = b.firstActiveAt.getTime();
  const bEnd = b.lastActiveAt.getTime();
  const interStart = Math.max(aStart, bStart);
  const interEnd = Math.min(aEnd, bEnd);
  if (interEnd <= interStart) return 0;
  const inter = interEnd - interStart;
  const uni = Math.max(aEnd, bEnd) - Math.min(aStart, bStart);
  return uni > 0 ? inter / uni : 0;
}

function contributionDensity(u: UserFeedbackVec): number {
  // 0~1. 기여가 풍부할수록 1에 가까움. 빈손에 가까울수록 0.
  // 휴리스틱: 기여 5건 이상이면 1, 적을수록 선형.
  const score = Math.min(1, u.contributionCount / 5);
  // stake도 가산 (있으면 더 가중)
  const stakeBonus = u.totalStake > 0 ? 0.2 : 0;
  return Math.min(1, score + stakeBonus);
}

export function suspicionScore(a: UserFeedbackVec, b: UserFeedbackVec): SuspicionEvidence {
  const jac = jaccard(a.positiveQaIds, b.positiveQaIds);
  const sync = timeOverlapFactor(a, b);
  const densA = contributionDensity(a);
  const densB = contributionDensity(b);
  const dens = (densA + densB) / 2;
  const score = Math.min(1, jac * (0.5 + 0.5 * sync) * (1 - dens));
  let inter = 0;
  for (const x of a.positiveQaIds) if (b.positiveQaIds.has(x)) inter++;
  return {
    userA: a.userId,
    userB: b.userId,
    jaccard: Number(jac.toFixed(3)),
    syncFactor: Number(sync.toFixed(3)),
    contributionDensity: Number(dens.toFixed(3)),
    score: Number(score.toFixed(3)),
    sharedPositiveCount: inter,
  };
}

export function flagThreshold(score: number): "ok" | "watch" | "suspect" {
  if (score >= 0.7) return "suspect";
  if (score >= 0.4) return "watch";
  return "ok";
}
