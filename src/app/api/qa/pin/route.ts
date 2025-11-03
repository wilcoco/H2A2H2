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
    if (!userId) return NextResponse.json({ items: [], ids: [] });

    const rows = await withConn(async (c) => {
      const r = await c.query(
        `select p.qa_id as id, q.question, q.summary
           from qa_pins p
           left join qa_entries q on q.id = p.qa_id
          where p.user_id = $1
          order by p.created_at desc`,
        [userId]
      );
      return r.rows as Array<{ id: string; question: string | null; summary: string | null }>;
    });
    return NextResponse.json({
      ids: rows.map((r) => r.id),
      items: rows.map((r) => ({ id: r.id, question: r.question ?? r.id, summary: r.summary ?? undefined })),
    });
  } catch (e) {
    return NextResponse.json({ items: [], ids: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const json = await req.json().catch(() => ({}));
    const qaId = (json?.qaId ?? "").toString();
    if (!qaId) return NextResponse.json({ error: "Missing qaId" }, { status: 400 });
    await withConn(async (c) => {
      await c.query(
        `insert into qa_pins (user_id, qa_id)
         values ($1,$2)
         on conflict (user_id, qa_id) do nothing`,
        [userId, qaId]
      );
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const json = await req.json().catch(() => ({}));
    const qaId = (json?.qaId ?? "").toString();
    if (!qaId) return NextResponse.json({ error: "Missing qaId" }, { status: 400 });
    await withConn(async (c) => {
      await c.query(`delete from qa_pins where user_id = $1 and qa_id = $2`, [userId, qaId]);
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
