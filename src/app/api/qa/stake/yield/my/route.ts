import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { distributeDividend, type StakeLike } from "@/lib/nightwish/economy";

export const runtime = "nodejs";

const HALF_LIFE_DAYS = Number(process.env.NIGHTWISH_HALF_LIFE || 30);
const DIVIDEND_RATE = Number(process.env.NIGHTWISH_DIVIDEND_RATE || 0.20);

interface RawStakeRow {
  stake_id: string;
  user_id: string;
  root_id: string;
  qa_id: string | null;
  amount: string | number;
  lock_days: number | string;
  created_at: string;
  lock_until: string;
  last_contribution_at: string | null;
  is_self: boolean;
  is_reclaimed: boolean;
  root_question: string | null;
}

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;
    if (!userId) return NextResponse.json({ items: [] });

    // 1. 내가 스테이크 건 모든 root_id 가져옴 (락 풀린 것만 결제 대상)
    const myRows = await withConn(async (c) => {
      const r = await c.query(
        `select s.id as stake_id, s.user_id, s.qa_root_id as root_id, s.qa_id, s.amount, s.lock_days,
                s.created_at, s.lock_until, s.last_contribution_at, s.is_self, s.is_reclaimed,
                q.question as root_question
           from stake_ledger s
           left join qa_entries q on q.id = s.qa_root_id
          where s.user_id = $1 and s.lock_until <= now() and s.is_reclaimed = false
          order by s.created_at desc`,
        [userId]
      );
      return r.rows as unknown as RawStakeRow[];
    });
    if (myRows.length === 0) return NextResponse.json({ items: [] });

    const rootIds = Array.from(new Set(myRows.map((r) => r.root_id)));

    // 2. 각 root_id 가지의 (a) 모든 스테이크 (b) 검증 여부 (c) 기여자 집합
    const branchInfo = await withConn(async (c) => {
      const allStakes = await c.query(
        `select id as stake_id, user_id, qa_root_id as root_id, qa_id, amount, created_at, lock_until,
                last_contribution_at, is_self, is_reclaimed
           from stake_ledger where qa_root_id = any($1)`,
        [rootIds]
      );
      const verifs = await c.query(
        `select coalesce(e.root_id, e.id) as root_id, bool_or(v.passes) as branch_verified
           from qa_verifications v
           join qa_entries e on e.id = v.qa_id
          where coalesce(e.root_id, e.id) = any($1)
          group by coalesce(e.root_id, e.id)`,
        [rootIds]
      );
      const contribs = await c.query(
        `with chain as (
           select id, coalesce(root_id, id) as root_id from qa_entries where coalesce(root_id, id) = any($1)
         )
         select chain.root_id, contributor from chain, lateral (
           select created_by as contributor from qa_entries where id = chain.id and created_by is not null
           union select user_id from qa_feedback where qa_id = chain.id
           union select user_id from qa_notes where qa_id = chain.id and user_id is not null
           union select created_by from qa_relations where (source_id = chain.id or target_id = chain.id) and created_by is not null
         ) c group by chain.root_id, contributor`,
        [rootIds]
      );
      const qrows = await c.query(
        `select coalesce(root_id, id) as root_id, max(coalesce(updated_at, created_at)) as last_update
           from qa_entries where coalesce(root_id, id) = any($1) group by coalesce(root_id, id)`,
        [rootIds]
      );
      return {
        stakes: allStakes.rows as unknown as RawStakeRow[],
        verified: new Map((verifs.rows as unknown as Array<{ root_id: string; branch_verified: boolean }>).map((r) => [r.root_id, r.branch_verified])),
        contribsByRoot: ((rows: Array<{ root_id: string; contributor: string }>) => {
          const m = new Map<string, Set<string>>();
          for (const r of rows) {
            if (!m.has(r.root_id)) m.set(r.root_id, new Set());
            m.get(r.root_id)!.add(r.contributor);
          }
          return m;
        })(contribs.rows as unknown as Array<{ root_id: string; contributor: string }>),
        lastUpdate: new Map((qrows.rows as unknown as Array<{ root_id: string; last_update: string }>).map((r) => [r.root_id, r.last_update])),
      };
    });

    const now = new Date();
    const toStake = (r: RawStakeRow): StakeLike => ({
      id: r.stake_id,
      userId: r.user_id,
      qaId: r.qa_id,
      qaRootId: r.root_id,
      amount: Number(r.amount || 0),
      createdAt: new Date(r.created_at),
      lockUntil: new Date(r.lock_until),
      lastContributionAt: r.last_contribution_at ? new Date(r.last_contribution_at) : new Date(r.created_at),
      isSelf: Boolean(r.is_self),
      isReclaimed: Boolean(r.is_reclaimed),
    });

    const items = myRows.map((my) => {
      const rootId = my.root_id;
      const branchStakes = branchInfo.stakes.filter((s) => s.root_id === rootId).map(toStake);
      const verified = Boolean(branchInfo.verified.get(rootId));
      const contributors = branchInfo.contribsByRoot.get(rootId) ?? new Set<string>();
      const payouts = distributeDividend(branchStakes, {
        isBranchVerified: verified,
        hasContribution: (u) => contributors.has(u),
        halfLifeDays: HALF_LIFE_DAYS,
        dividendRate: DIVIDEND_RATE,
        now,
      });
      const myPayout = Math.round(payouts[userId] || 0);

      const ageMs = now.getTime() - (my.last_contribution_at ? new Date(my.last_contribution_at).getTime() : new Date(my.created_at).getTime());
      const ageDays = Math.floor(ageMs / 86400_000);
      const decayFactor = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);

      return {
        stakeId: my.stake_id,
        rootId,
        qaId: my.qa_id || undefined,
        amount: Number(my.amount || 0),
        lockDays: Number(my.lock_days || 0),
        createdAt: my.created_at,
        lockUntil: my.lock_until,
        lastContributionAt: my.last_contribution_at || my.created_at,
        rootQuestion: my.root_question || undefined,
        // nightwish gates
        branchVerified: verified,
        eligible: verified && contributors.has(userId) && !my.is_self && !my.is_reclaimed,
        ageDays,
        decayFactor: Number(decayFactor.toFixed(3)),
        estimatedYield: myPayout,
        // 이유 표시용
        gateReason: !verified ? "branch_not_verified" : my.is_self ? "self_stake" : my.is_reclaimed ? "reclaimed" : !contributors.has(userId) ? "no_contribution" : "ok",
      };
    });

    return NextResponse.json({
      items,
      params: { halfLifeDays: HALF_LIFE_DAYS, dividendRate: DIVIDEND_RATE },
    });
  } catch (e) {
    return NextResponse.json({ items: [] });
  }
}
