// Anti-Matthew quota — critique §4.
// "라우팅이 곧 기회이고 기회가 곧 소득이면, 라우팅 분류기는 사실상 분배기다."
// 검색/피드 결과의 일부를 강제로 *신규/잠복/저허브* 노드로 채워 마태효과를 약화시킨다.
// 사용자가 의도적으로 strict mode를 켜면 우회 가능 (그래야 정확성을 해치지 않음).

export interface RankItem<T> {
  data: T;
  score: number;
  isExplore: boolean;   // 신규/잠복/저허브 카테고리인가
}

export interface QuotaOptions {
  limit: number;
  exploreShare?: number;   // 0~1, 기본 0.3 (=30%)
  bypass?: boolean;        // true면 quota 비활성화
}

// 정렬·중복 제거된 두 리스트(top, explore)를 quota에 맞게 인터리브.
// top: 점수순 기존 결과. explore: 신규/잠복/저허브 풀.
export function applyAntiMatthewQuota<T extends { id: string }>(
  top: T[],
  explore: T[],
  opts: QuotaOptions
): T[] {
  const limit = Math.max(1, opts.limit);
  if (opts.bypass) return top.slice(0, limit);
  const share = Math.max(0, Math.min(1, opts.exploreShare ?? 0.3));
  const exploreSlots = Math.round(limit * share);
  const topSlots = limit - exploreSlots;

  const seen = new Set<string>();
  const out: T[] = [];

  // 라운드 로빈에 가까운 인터리브: 처음 몇 자리는 top, 그 다음 explore, ...
  const tIter = top[Symbol.iterator]();
  const eIter = explore[Symbol.iterator]();
  let tCount = 0;
  let eCount = 0;

  function pushUnique(item: T | undefined): boolean {
    if (!item) return false;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    out.push(item);
    return true;
  }

  while (out.length < limit) {
    const wantExplore = (tCount >= topSlots) || (eCount < exploreSlots && out.length % 3 === 2);
    if (wantExplore) {
      const v = eIter.next();
      if (!v.done && pushUnique(v.value)) { eCount++; continue; }
      // explore 풀 고갈 — top으로 채움
      const w = tIter.next();
      if (w.done) break;
      if (pushUnique(w.value)) tCount++;
    } else {
      const v = tIter.next();
      if (!v.done && pushUnique(v.value)) { tCount++; continue; }
      const w = eIter.next();
      if (w.done) break;
      if (pushUnique(w.value)) eCount++;
    }
  }

  return out;
}
