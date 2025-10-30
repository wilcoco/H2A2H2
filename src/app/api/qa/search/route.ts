import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = await req.json().catch(() => ({}));
    const query: string = (body?.query ?? "").toString();
    const limit: number = Math.min(Math.max(Number(body?.limit ?? 5), 1), 10);
    const strict: boolean = !!body?.strict;
    const q = query.trim();
    let rows: Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string }> = [];
    if (q) {
      try {
        rows = await withConn(async (c) => {
          // Try trigram similarity and simple LIKE matching
          const r = await c.query(
            `select id, question, answer, summary, work_id
               from qa_entries
              where (
                similarity(lower(question), $1) > 0.2
                or lower(question) like ('%' || $1 || '%')
                or lower(coalesce(summary, '')) like ('%' || $1 || '%')
              )
              order by greatest(
                       similarity(lower(question), $1),
                       case when lower(question) like ('%' || $1 || '%') then 0.9 else 0 end,
                       case when lower(coalesce(summary, '')) like ('%' || $1 || '%') then 0.6 else 0 end
                     ) desc,
                       created_at desc
              limit $2`,
            [q.toLowerCase(), limit]
          );
          return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string }>;
        });
      } catch {
        // Fallback to LIKE-only if pg_trgm/similarity is unavailable
        rows = await withConn(async (c) => {
          const r = await c.query(
            `select id, question, answer, summary, work_id
               from qa_entries
              where lower(question) like ('%' || $1 || '%')
                 or lower(coalesce(summary,'')) like ('%' || $1 || '%')
              order by created_at desc
              limit $2`,
            [q.toLowerCase(), limit]
          );
          return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string }>;
        });
      }
    }
    // Fallback to recent if no matches
    if ((!rows || rows.length === 0) && !strict) {
      rows = await withConn(async (c) => {
        const r = await c.query(
          `select id, question, answer, summary, work_id from qa_entries
           order by created_at desc limit $1`,
          [limit]
        );
        return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string }>;
      });
    }
    const items = rows.map((r) => ({
      id: r.id,
      question: r.question,
      answer: r.answer ?? undefined,
      summary: r.summary ?? undefined,
      workId: r.work_id ?? undefined,
    }));
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
