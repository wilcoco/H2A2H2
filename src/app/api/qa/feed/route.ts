import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";

function parseWindow(win: string | null): { expr: string } {
  switch ((win || "24h").toLowerCase()) {
    case "24h":
      return { expr: "now() - interval '24 hours'" };
    case "7d":
      return { expr: "now() - interval '7 days'" };
    case "all":
      return { expr: "to_timestamp(0)" };
    default:
      return { expr: "now() - interval '24 hours'" };
  }
}

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const url = new URL(req.url);
    const sort = (url.searchParams.get("sort") || "staked").toLowerCase();
    const win = parseWindow(url.searchParams.get("window"));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));

    if (sort === "staked") {
      const rows = await withConn(async (c) => {
        const sql = `
          with stakes as (
            select qa_root_id as rid,
                   sum( sqrt( greatest(amount,1) ) * case when is_self then 0.3 else 1 end ) as s_sum
            from stake_ledger
            where created_at >= ${win.expr}
            group by qa_root_id
          ),
          totals as (
            select coalesce(sum(s_sum), 0) as W from stakes
          ),
          fb as (
            select coalesce(e.root_id, e.id) as rid,
                   sum(case when f.vote = 1 then 1 else 0 end) as helpful,
                   sum(case when f.vote = -1 then 1 else 0 end) as unhelpful
            from qa_entries e
            join qa_feedback f on f.qa_id = e.id
            group by coalesce(e.root_id, e.id)
          )
          select s.rid as root_id,
                 q.question as root_question,
                 s.s_sum::float as stake_raw,
                 (s.s_sum::float) / (100 + (select W from totals)) as stake_norm,
                 coalesce(fb.helpful,0) as helpful,
                 coalesce(fb.unhelpful,0) as unhelpful,
                 q.created_at
          from stakes s
          join qa_entries q on q.id = s.rid
          left join fb on fb.rid = s.rid
          order by stake_norm desc, q.created_at desc
          limit $1`;
        const r = await c.query(sql, [limit]);
        return r.rows as Array<{ root_id: string; root_question: string | null; stake_raw: number; stake_norm: number; helpful: string | number | null; unhelpful: string | number | null; created_at: string }>;
      });
      return NextResponse.json({
        items: rows.map((r) => ({
          id: r.root_id,
          rootId: r.root_id,
          question: r.root_question || r.root_id,
          stakeRaw: Number(r.stake_raw || 0),
          stakeNorm: Number(r.stake_norm || 0),
          helpful: Number(r.helpful || 0),
          unhelpful: Number(r.unhelpful || 0),
          createdAt: r.created_at,
        })),
      });
    }

    if (sort === "new") {
      const rows = await withConn(async (c) => {
        const sql = `
          select id, question, created_at
          from qa_entries
          where published = true
          order by created_at desc
          limit $1`;
        const r = await c.query(sql, [limit]);
        return r.rows as Array<{ id: string; question: string | null; created_at: string }>;
      });
      return NextResponse.json({
        items: rows.map((r) => ({ id: r.id, rootId: r.id, question: r.question || r.id, createdAt: r.created_at })),
      });
    }

    return NextResponse.json({ items: [] });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
