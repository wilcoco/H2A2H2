import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

function uuid(): string {
  return "note_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const url = new URL(req.url);
    const qaId = url.searchParams.get("qaId")?.toString();
    if (!qaId) return NextResponse.json({ notes: [] });
    const rows = await withConn(async (c) => {
      const r = await c.query(
        `select id, qa_id, user_id, content, created_at from qa_notes where qa_id = $1 order by created_at asc`,
        [qaId]
      );
      return r.rows as Array<{ id: string; qa_id: string; user_id: string | null; content: string; created_at: string }>
    });
    return NextResponse.json({
      notes: rows.map((n) => ({ id: n.id, qaId: n.qa_id, userId: n.user_id ?? undefined, content: n.content, createdAt: n.created_at }))
    });
  } catch (e) {
    return NextResponse.json({ notes: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;

    const body = await req.json().catch(() => ({}));
    const qaId: string = (body?.qaId ?? "").toString();
    const content: string = (body?.content ?? "").toString();
    if (!qaId || !content.trim()) return NextResponse.json({ error: "Missing qaId or content" }, { status: 400 });

    const id = uuid();
    await withConn(async (c) => {
      await c.query(
        `insert into qa_notes (id, qa_id, user_id, content) values ($1,$2,$3,$4)`,
        [id, qaId, userId, content.trim()]
      );
    });
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
