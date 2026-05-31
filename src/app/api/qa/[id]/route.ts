import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await ensureTables();
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;
    const row = await withConn(async (c) => {
      const r = await c.query(
        `select q.id, q.question, q.norm_question, q.answer, q.summary, q.patch, q.work_id, q.created_by, q.created_at, q.root_id, q.published, q.last_response_id,
                coalesce(sum(case when f.vote = 1 then 1 else 0 end),0) as helpful,
                coalesce(sum(case when f.vote = -1 then 1 else 0 end),0) as unhelpful,
                max(case when f.user_id = $2 then f.vote else null end) as my_vote
         from qa_entries q
         left join qa_feedback f on f.qa_id = q.id
         where q.id = $1
         group by q.id`,
        [id, userId]
      );
      return r.rows?.[0] ?? null;
    });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      id: row.id,
      question: row.question,
      normQuestion: row.norm_question ?? undefined,
      answer: row.answer ?? undefined,
      summary: row.summary ?? undefined,
      patch: row.patch ?? undefined,
      workId: row.work_id ?? undefined,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
      rootId: row.root_id ?? undefined,
      published: row.published !== false,
      lastResponseId: row.last_response_id ?? undefined,
      helpful: Number(row.helpful || 0),
      unhelpful: Number(row.unhelpful || 0),
      myVote: row.my_vote === 1 ? 1 : row.my_vote === -1 ? -1 : 0,
    });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
