import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";

function uuid(): string {
  return "qa_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = await req.json().catch(() => ({}));
    const question: string = (body?.question ?? "").toString();
    const answer: string | undefined = body?.answer ? String(body.answer) : undefined;
    let summary: string | undefined = body?.summary ? String(body.summary) : undefined;
    const patch: any | undefined = body?.patch ?? undefined;
    const workId: string | undefined = body?.workId ? String(body.workId) : undefined;
    const createdBy: string | undefined = body?.createdBy ? String(body.createdBy) : undefined;
    const parentId: string | undefined = body?.parentId ? String(body.parentId) : undefined;

    const q = question.trim();
    if (!q) return NextResponse.json({ error: "Missing question" }, { status: 400 });

    // server-side summary fallback
    if (!summary) {
      try {
        if (patch?.description && typeof patch.description === "string") {
          summary = String(patch.description).slice(0, 280);
        } else if (answer) {
          summary = answer.replace(/\s+/g, " ").slice(0, 280);
        }
      } catch {}
    }

    const id = uuid();
    let rootId: string | null = null;
    if (parentId) {
      const parent = await withConn(async (c) => {
        const r = await c.query(`select id, root_id from qa_entries where id = $1`, [parentId]);
        return r.rows?.[0] ?? null;
      });
      if (parent) rootId = parent.root_id ?? parent.id;
    }
    await withConn(async (c) => {
      await c.query(
        `insert into qa_entries (id, question, norm_question, answer, summary, patch, work_id, created_by, parent_id, root_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, q, normalize(q), answer ?? null, summary ?? null, patch ?? null, workId ?? null, createdBy ?? null, parentId ?? null, rootId ?? id]
      );
    });

    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: "Failed to share" }, { status: 500 });
  }
}
