import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;
    if (!userId) return NextResponse.json({ items: [] });

    const url = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));

    const rows = await withConn(async (c) => {
      const sql = `
        with fb as (
          select coalesce(e.root_id, e.id) as rid,
                 sum(case when f.vote = 1 then 1 else 0 end) as helpful,
                 sum(case when f.vote = -1 then 1 else 0 end) as unhelpful
          from qa_entries e
          join qa_feedback f on f.qa_id = e.id
          group by coalesce(e.root_id, e.id)
        )
        select s.id, s.qa_root_id as root_id, s.qa_id, s.amount, s.lock_days, s.created_at, s.lock_until,
               q.question as root_question,
               coalesce(fb.helpful, 0) as helpful,
               coalesce(fb.unhelpful, 0) as unhelpful
        from stake_ledger s
        left join qa_entries q on q.id = s.qa_root_id
        left join fb on fb.rid = s.qa_root_id
        where s.user_id = $1
        order by s.created_at desc
        limit $2`;
      const r = await c.query(sql, [userId, limit]);
      return r.rows as Array<{
        id: string;
        root_id: string;
        qa_id: string | null;
        amount: number;
        lock_days: number;
        created_at: string;
        lock_until: string;
        root_question: string | null;
        helpful: string | number | null;
        unhelpful: string | number | null;
      }>;
    });

    const items = rows.map((r) => {
      const helpful = Number(r.helpful || 0);
      const unhelpful = Number(r.unhelpful || 0);
      const total = Math.max(1, helpful + unhelpful);
      const qualityScore = (helpful - unhelpful) / total;
      return {
        id: r.id,
        rootId: r.root_id,
        qaId: r.qa_id || undefined,
        amount: Number(r.amount || 0),
        lockDays: Number(r.lock_days || 0),
        createdAt: r.created_at,
        lockUntil: r.lock_until,
        rootQuestion: r.root_question || undefined,
        helpful,
        unhelpful,
        qualityScore,
      };
    });

    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ items: [] });
  }
}
