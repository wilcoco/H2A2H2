import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.toString().trim() || "";
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));

    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;

    if (!userId) return NextResponse.json({ items: [] });

    const rows = await withConn(async (c) => {
      const params: unknown[] = [userId, limit];
      let where = `created_by = $1`;
      if (q) {
        params.splice(1, 0, `%${q.toLowerCase()}%`);
        where += ` and (norm_question like $2 or question ilike $2)`;
        params[params.length - 1] = limit; // ensure limit is last param
      }
      const sql = `
        with agg as (
          select qa_id,
                 sum(case when vote = 1 then 1 else 0 end) as helpful,
                 sum(case when vote = -1 then 1 else 0 end) as unhelpful
          from qa_feedback
          group by qa_id
        )
        select q.id, q.question, q.summary, q.root_id, q.created_at,
               coalesce(a.helpful,0) as helpful,
               coalesce(a.unhelpful,0) as unhelpful
        from qa_entries q
        left join agg a on a.qa_id = q.id
        where ${where}
        order by q.created_at desc
        limit ${q ? '$3' : '$2'}`;
      const r = await c.query(sql, params);
      return r.rows as Array<{ id: string; question: string; summary: string | null; root_id: string | null; created_at: string; helpful: string | number; unhelpful: string | number }>;
    });

    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        question: r.question,
        summary: r.summary ?? undefined,
        rootId: r.root_id ?? undefined,
        createdAt: r.created_at,
        helpful: Number(r.helpful || 0),
        unhelpful: Number(r.unhelpful || 0),
      })),
    });
  } catch (e) {
    return NextResponse.json({ items: [] });
  }
}
