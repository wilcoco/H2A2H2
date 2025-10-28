import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureTables();
    const id = params?.id;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const row = await withConn(async (c) => {
      const r = await c.query(
        `select id, question, norm_question, answer, summary, patch, work_id, created_by, created_at from qa_entries where id = $1`,
        [id]
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
    });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
