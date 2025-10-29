import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = await req.json().catch(() => ({}));
    const query: string = (body?.query ?? "").toString();
    const limit: number = Math.min(Math.max(Number(body?.limit ?? 5), 1), 10);
    const q = query.trim();
    let rows: Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string }> = [];
    if (q) {
      rows = await withConn(async (c) => {
        // Try trigram similarity first
        const r = await c.query(
          `select id, question, answer, summary, work_id
           from qa_entries
           where similarity(lower(question), $1) > 0.2
           order by similarity(lower(question), $1) desc, created_at desc
           limit $2`,
          [q.toLowerCase(), limit]
        );
        return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string }>;
      });
    }
    // Fallback to recent if no matches
    if (!rows || rows.length === 0) {
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
