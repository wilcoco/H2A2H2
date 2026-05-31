// nightwish/tree.py 헬퍼 — fork/dormant/revive 판정용
// "수렴 거부": 진 가지는 죽지 않고 잠복하다가 후대가 부활시킨다 (갈릴레오 문제).

export function isDormant(lastActivityAt: Date, dormantDays: number, now: Date): boolean {
  const ms = now.getTime() - lastActivityAt.getTime();
  return ms > dormantDays * 86400_000;
}

// 한 가지(root_id) 안에서 동일 질문에 대한 alternative 답을 fork로 본다.
export function isForkOf(
  candidate: { question: string; rootId: string; forkedFrom: string | null },
  parent: { id: string; question: string; rootId: string }
): boolean {
  return candidate.forkedFrom === parent.id || candidate.question.trim() === parent.question.trim();
}
