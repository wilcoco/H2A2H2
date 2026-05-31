import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { z } from "zod";
import { reclaimAmount, discoveryBonus } from "@/lib/nightwish/economy";

export const runtime = "nodejs";

const DORMANT_DAYS = Number(process.env.NIGHTWISH_DORMANT_DAYS || 30);
const DISCOVERY_BONUS_RATE = Number(process.env.NIGHTWISH_DISCOVERY_BONUS || 0.10);

// GET: 잠복 가지 리스트 (자식이 없고 dormant_days 이상 활동 없음)
export async function GET() {
  try {
    await ensureTables();
    const rows = await withConn(async (c) => {
      // 마킹 후보 탐색 — leaf이면서 last_activity > DORMANT_DAYS
      const r = await c.query(
        `with leaves as (
           select e.id, e.question, e.summary, e.answer, e.created_at, e.created_by, coalesce(e.root_id, e.id) as root_id,
                  coalesce(
                    (select max(created_at) from qa_feedback f where f.qa_id = e.id),
                    (select max(created_at) from qa_notes n where n.qa_id = e.id),
                    (select max(created_at) from qa_entries c2 where c2.parent_id = e.id),
                    e.created_at
                  ) as last_activity
             from qa_entries e
            where e.published = true
              and not exists (select 1 from qa_entries c where c.parent_id = e.id)
         )
         select * from leaves
          where last_activity < now() - ($1 || ' days')::interval
          order by last_activity asc
          limit 100`,
        [String(DORMANT_DAYS)]
      );
      return r.rows as Array<{
        id: string; question: string; summary: string | null; answer: string | null;
        created_at: string; created_by: string | null; root_id: string; last_activity: string;
      }>;
    });

    // 표시용 stake amount 합산
    const ids = rows.map((r) => r.id);
    let stakeMap: Record<string, number> = {};
    if (ids.length > 0) {
      stakeMap = await withConn(async (c) => {
        const r = await c.query(
          `select qa_id, coalesce(sum(amount),0) as total from stake_ledger
            where qa_id = any($1) and is_reclaimed = false group by qa_id`,
          [ids]
        );
        const m: Record<string, number> = {};
        for (const row of r.rows as Array<{ qa_id: string; total: string | number }>) {
          m[row.qa_id] = Number(row.total || 0);
        }
        return m;
      });
    }

    return NextResponse.json({
      dormantDays: DORMANT_DAYS,
      items: rows.map((r) => ({
        id: r.id,
        question: r.question,
        summary: r.summary || (r.answer ? String(r.answer).slice(0, 280) : null),
        createdAt: r.created_at,
        createdBy: r.created_by,
        rootId: r.root_id,
        lastActivity: r.last_activity,
        liveStake: stakeMap[r.id] || 0,
      })),
    });
  } catch {
    return NextResponse.json({ items: [], dormantDays: DORMANT_DAYS });
  }
}

// POST: reclaim — 잠복 노드의 라이브 스테이크를 유동성 풀로 환원 (소각 아님)
//       revive  — 잠복 노드를 부활시키고 reclaimed 스테이크를 복원, 발견자 보너스 지급
const ActionBody = z.object({
  action: z.enum(["reclaim", "revive"]),
  qaId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const input = ActionBody.parse(await req.json());

    if (input.action === "reclaim") {
      const reclaimed = await withConn(async (c) => {
        // 라이브 stake 가져와서 reclaim_amount 계산
        const r = await c.query(
          `select id, user_id, amount, last_contribution_at, is_self, is_reclaimed, created_at, lock_until, qa_id, qa_root_id
             from stake_ledger where qa_id = $1 and is_reclaimed = false`,
          [input.qaId]
        );
        const stakes = (r.rows as Array<{ id: string; amount: number | string; is_reclaimed: boolean }>).map((s) => ({
          ...s,
          amount: Number(s.amount || 0),
        }));
        const total = reclaimAmount(stakes.map((s) => ({
          id: s.id, userId: "", qaId: input.qaId, qaRootId: "",
          amount: s.amount, createdAt: new Date(), lockUntil: new Date(),
          lastContributionAt: new Date(), isSelf: false, isReclaimed: s.is_reclaimed,
        })));

        // 마킹
        await c.query(
          `update stake_ledger set is_reclaimed = true, reclaimed_at = now()
            where qa_id = $1 and is_reclaimed = false`,
          [input.qaId]
        );
        // qa_entries 상태 갱신
        await c.query(
          `update qa_entries set status = 'dormant', dormant_since = now() where id = $1`,
          [input.qaId]
        );
        // 유동성 풀 가산
        await c.query(`update liquidity_pool set balance = balance + $1, updated_at = now() where id = 1`, [total]);
        await c.query(
          `insert into liquidity_log (kind, qa_id, amount, actor, detail)
           values ('reclaim', $1, $2, $3, 'auto-reclaim from dormant')`,
          [input.qaId, total, user.email]
        );
        return total;
      });

      return NextResponse.json({ ok: true, action: "reclaim", reclaimed, qaId: input.qaId });
    }

    // revive
    const result = await withConn(async (c) => {
      // 1. 잠복 상태 확인
      const rq = await c.query(`select id, status from qa_entries where id = $1`, [input.qaId]);
      if (!rq.rowCount) throw new Error("QA not found");
      const status = String(rq.rows[0].status || "active");
      if (status !== "dormant") throw new Error("QA is not dormant");

      // 2. reclaimed stakes 복원 (is_reclaimed = false 로 되돌림)
      const rs = await c.query(
        `select id, amount from stake_ledger where qa_id = $1 and is_reclaimed = true`,
        [input.qaId]
      );
      const restoredTotal = (rs.rows as Array<{ amount: number | string }>).reduce((a, s) => a + Number(s.amount || 0), 0);

      // 유동성 풀에서 차감 (잔액 부족 시 가능한 만큼만 — 베타에서는 단순화)
      const lp = await c.query(`select balance from liquidity_pool where id = 1`);
      const pool = Number(lp.rows[0]?.balance || 0);
      const take = Math.min(pool, restoredTotal);
      await c.query(`update liquidity_pool set balance = balance - $1, updated_at = now() where id = 1`, [take]);
      await c.query(
        `update stake_ledger set is_reclaimed = false, reclaimed_at = null where qa_id = $1 and is_reclaimed = true`,
        [input.qaId]
      );

      // 3. 부활 마킹
      await c.query(
        `update qa_entries set status = 'active', revived_at = now(), revived_by = $2 where id = $1`,
        [input.qaId, user.email]
      );
      // 4. 발견자 보너스 (유동성 풀에서)
      const bonus = discoveryBonus(restoredTotal, DISCOVERY_BONUS_RATE);
      const lp2 = await c.query(`select balance from liquidity_pool where id = 1`);
      const pool2 = Number(lp2.rows[0]?.balance || 0);
      const bonusActual = Math.min(pool2, bonus);
      if (bonusActual > 0) {
        await c.query(`update liquidity_pool set balance = balance - $1, updated_at = now() where id = 1`, [bonusActual]);
        await c.query(
          `insert into liquidity_log (kind, qa_id, amount, actor, detail)
           values ('bonus', $1, $2, $3, 'revival discovery bonus')`,
          [input.qaId, bonusActual, user.email]
        );
      }
      await c.query(
        `insert into liquidity_log (kind, qa_id, amount, actor, detail)
         values ('restore', $1, $2, $3, 'restored stakes on revival')`,
        [input.qaId, take, user.email]
      );

      return { restored: take, bonus: bonusActual };
    });

    return NextResponse.json({ ok: true, action: "revive", qaId: input.qaId, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
