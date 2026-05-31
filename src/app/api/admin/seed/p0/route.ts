import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { randomUUID } from "crypto";
import { passes as measurementPasses, type Measurement } from "@/lib/nightwish/verification";

export const runtime = "nodejs";

// nightwish roadmap.md §P0:
// "먼저 공장의 불량 하나를 트리에 올려 물성으로 검증하라.
//  그 한 바퀴가 돌면 화폐도 거버넌스도 비로소 닻을 얻는다."
//
// 외부 현실 닻을 가진 데모 첫 노드를 시드. admin (governance_state.admin_email) 만 실행.
// 중복 시드 방지: 같은 marker로 이미 있으면 no-op.

const MARKER = "p0_demo_weldline_defect";

function uuid(): string {
  return "qa_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function GET() {
  try {
    await ensureTables();
    const exists = await withConn(async (c) => {
      const r = await c.query(`select id from qa_entries where summary = $1 limit 1`, [MARKER]);
      return r.rows[0]?.id as string | undefined;
    });
    return NextResponse.json({ seeded: !!exists, qaId: exists || null });
  } catch {
    return NextResponse.json({ seeded: false, qaId: null });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // admin 체크
    const admin = await withConn(async (c) => {
      const r = await c.query(`select admin_email from governance_state where id = 1`);
      return (r.rows[0]?.admin_email || process.env.GOVERNANCE_ADMIN || "") as string;
    });
    if (admin && user.email !== admin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    // 중복 방지
    const existing = await withConn(async (c) => {
      const r = await c.query(`select id from qa_entries where summary = $1 limit 1`, [MARKER]);
      return r.rows[0]?.id as string | undefined;
    });
    if (existing) {
      return NextResponse.json({ ok: true, alreadySeeded: true, qaId: existing });
    }

    const id = uuid();
    const question = "사출 웰드라인 불량률을 어떻게 낮출까?";
    const answer = [
      "1) 사출속도 단계별 프로파일링: 게이트 통과 후 가속, 합류부 직전 감속.",
      "2) 금형 온도 +5℃ 상향(코어/캐비티 균형) — 합류부 점도 저하로 분자 정렬 향상.",
      "3) 가스 벤트 위치 합류부 직선상에 추가 — 트랩 가스가 라인을 굳힘.",
      "4) 게이트 위치 재배치(가능 시) — 합류부 자체를 비기능 영역으로 이동.",
      "검증 지표: 라인 A의 1주일 불량률 (변경 전 8%, 변경 후 2% 목표).",
    ].join("\n");

    await withConn(async (c) => {
      await c.query(
        `insert into qa_entries (id, question, norm_question, answer, summary, work_id, created_by, parent_id, root_id, published)
         values ($1,$2,$3,$4,$5,null,$6,null,$1,true)`,
        [id, question, normalize(question), answer, MARKER, user.email]
      );

      // 검증 메트릭 — passes 자동 판정 (8→2%, lower_better, min 20% 개선 → 75% 개선이라 통과)
      const m: Measurement = {
        metric: "defect_rate",
        baseline: 8,
        observed: 2,
        direction: "lower_better",
        unit: "%",
        minRelImprovement: 0.2,
      };
      await c.query(
        `insert into qa_verifications
           (id, qa_id, metric, baseline, observed, unit, direction, min_rel_improvement, source_url, source_note, verified_by, passes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          randomUUID(),
          id,
          m.metric,
          m.baseline,
          m.observed,
          m.unit ?? null,
          m.direction,
          m.minRelImprovement ?? 0,
          null,
          "데모 시드 — 공장 라인 A, 1주일 추적 (가상 데이터)",
          user.email,
          measurementPasses(m),
        ]
      );
    });

    return NextResponse.json({ ok: true, alreadySeeded: false, qaId: id, question });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
