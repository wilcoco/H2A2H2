import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { suspicionScore, flagThreshold, type UserFeedbackVec } from "@/lib/nightwish/sybil";

export const runtime = "nodejs";

// admin이 트리거. 모든 사용자 페어의 의심 점수 계산 후 임계 이상만 sybil_signals에 저장.
// 베타에서는 단순 O(N²); 향후 LSH/MinHash로 교체 가능.

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = await withConn(async (c) => {
      const r = await c.query(`select admin_email from governance_state where id = 1`);
      return (r.rows[0]?.admin_email || process.env.GOVERNANCE_ADMIN || "") as string;
    });
    if (admin && user.email !== admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const rows = await withConn(async (c) => {
      const feedbacks = await c.query(
        `select user_id, qa_id, vote, created_at from qa_feedback where vote = 1`
      );
      const contribs = await c.query(
        `with all_contribs as (
           select created_by as u, created_at from qa_entries where created_by is not null
           union all select user_id, created_at from qa_notes where user_id is not null
           union all select created_by, created_at from qa_relations where created_by is not null
         )
         select u as user_id, count(*)::int as n,
                min(created_at) as first_at, max(created_at) as last_at
           from all_contribs group by u`
      );
      const stakes = await c.query(
        `select user_id, coalesce(sum(amount),0) as total from stake_ledger group by user_id`
      );
      return {
        feedbacks: feedbacks.rows as Array<{ user_id: string; qa_id: string; vote: number; created_at: string }>,
        contribs: contribs.rows as Array<{ user_id: string; n: number; first_at: string; last_at: string }>,
        stakes: stakes.rows as Array<{ user_id: string; total: number | string }>,
      };
    });

    const vecs = new Map<string, UserFeedbackVec>();
    for (const c of rows.contribs) {
      vecs.set(c.user_id, {
        userId: c.user_id,
        positiveQaIds: new Set(),
        contributionCount: Number(c.n || 0),
        totalStake: 0,
        firstActiveAt: c.first_at ? new Date(c.first_at) : null,
        lastActiveAt: c.last_at ? new Date(c.last_at) : null,
      });
    }
    for (const f of rows.feedbacks) {
      if (!vecs.has(f.user_id)) vecs.set(f.user_id, {
        userId: f.user_id,
        positiveQaIds: new Set(),
        contributionCount: 0,
        totalStake: 0,
        firstActiveAt: f.created_at ? new Date(f.created_at) : null,
        lastActiveAt: f.created_at ? new Date(f.created_at) : null,
      });
      const v = vecs.get(f.user_id)!;
      v.positiveQaIds.add(f.qa_id);
      const t = new Date(f.created_at);
      if (!v.firstActiveAt || t < v.firstActiveAt) v.firstActiveAt = t;
      if (!v.lastActiveAt || t > v.lastActiveAt) v.lastActiveAt = t;
    }
    for (const s of rows.stakes) {
      const v = vecs.get(s.user_id);
      if (v) v.totalStake = Number(s.total || 0);
    }

    const users = [...vecs.values()].filter((v) => v.positiveQaIds.size > 0);
    let inserted = 0;
    await withConn(async (c) => {
      // 같은 사용자 페어의 이전 시그널 제거 (재계산)
      await c.query(`delete from sybil_signals where computed_at < now() - interval '30 days'`);
      for (let i = 0; i < users.length; i++) {
        for (let j = i + 1; j < users.length; j++) {
          const a = users[i];
          const b = users[j];
          const ev = suspicionScore(a, b);
          const flag = flagThreshold(ev.score);
          if (flag === "ok") continue;
          await c.query(
            `insert into sybil_signals (user_id, peer_user_id, suspicion_score, reason, evidence)
             values ($1, $2, $3, $4, $5)`,
            [a.userId, b.userId, ev.score, flag, JSON.stringify(ev)]
          );
          inserted++;
        }
      }
    });

    return NextResponse.json({ ok: true, usersAnalyzed: users.length, signalsInserted: inserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  try {
    await ensureTables();
    const rows = await withConn(async (c) => {
      const r = await c.query(
        `select user_id, peer_user_id, suspicion_score, reason, evidence, computed_at
           from sybil_signals
          where computed_at > now() - interval '30 days'
          order by suspicion_score desc, computed_at desc
          limit 100`
      );
      return r.rows;
    });
    return NextResponse.json({ items: rows });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
