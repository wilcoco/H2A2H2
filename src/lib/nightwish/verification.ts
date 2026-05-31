// nightwish/verification.py 포팅 — 외부 현실 닻 (ground-truth verification)
// critique §1.1, §2, §6 — "동의가 유일한 가치 원천이면, 동의는 조작될 수 있다."
// 닻이 없는 가지에서 배당을 끄면 "정교한 폰지와 구별 불가" 상태가 차단된다.

export type Direction = "higher_better" | "lower_better";

export interface Measurement {
  metric: string;
  baseline: number;
  observed: number;
  direction: Direction;
  unit?: string;
  minRelImprovement?: number;
}

export function relativeImprovement(m: Measurement): number {
  const delta = m.direction === "higher_better" ? m.observed - m.baseline : m.baseline - m.observed;
  const denom = Math.abs(m.baseline);
  return denom > 1e-12 ? delta / denom : delta;
}

export function passes(m: Measurement): boolean {
  const imp = relativeImprovement(m);
  const min = m.minRelImprovement ?? 0;
  return imp > 0 && imp >= min;
}

export function classifyDirection(metric: string): Direction {
  return /(defect|error|fault|loss|rate|fail|cycle|latency|cost)/i.test(metric) ? "lower_better" : "higher_better";
}
