"use client";

type Props = {
  ageDays: number;             // 현재 경과일
  halfLifeDays?: number;       // 반감기 (기본 30)
  width?: number;
  height?: number;
};

// 시간붕괴 가시화 — yield 옆에 작은 차트로 노출.
// y = 0.5^(t/halfLife). 현재 위치를 빨간 점, 다음 60일 곡선.
export default function DecayCurve({ ageDays, halfLifeDays = 30, width = 180, height = 60 }: Props) {
  const days = 90;
  const points: Array<[number, number]> = [];
  for (let t = 0; t <= days; t += 2) {
    const y = Math.pow(0.5, t / halfLifeDays);
    points.push([t, y]);
  }
  const xScale = (t: number) => (t / days) * (width - 8) + 4;
  const yScale = (y: number) => (1 - y) * (height - 12) + 4;
  const path = points.map(([t, y], i) => `${i === 0 ? "M" : "L"}${xScale(t).toFixed(1)},${yScale(y).toFixed(1)}`).join("");
  const cur = Math.max(0, Math.min(days, ageDays));
  const curY = Math.pow(0.5, cur / halfLifeDays);
  const halfX = xScale(halfLifeDays);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <rect x="0" y="0" width={width} height={height} fill="transparent" />
      {/* 반감기 가이드 */}
      <line x1={halfX} y1="4" x2={halfX} y2={height - 4} stroke="#cbd5e1" strokeDasharray="2,2" />
      <text x={halfX + 2} y="12" fontSize="9" fill="#94a3b8">half</text>
      {/* 곡선 */}
      <path d={path} fill="none" stroke="#7c3aed" strokeWidth="1.5" />
      {/* 현재 점 */}
      <circle cx={xScale(cur)} cy={yScale(curY)} r="3.5" fill="#dc2626" />
      <text x={xScale(cur) + 5} y={yScale(curY) - 2} fontSize="9" fill="#dc2626">×{curY.toFixed(2)}</text>
      {/* 축 */}
      <line x1="4" y1={height - 4} x2={width - 4} y2={height - 4} stroke="#e2e8f0" />
      <text x="4" y={height - 1} fontSize="8" fill="#94a3b8">0d</text>
      <text x={width - 14} y={height - 1} fontSize="8" fill="#94a3b8">{days}d</text>
    </svg>
  );
}
