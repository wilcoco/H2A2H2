import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const json = await req.json().catch(() => ({}));
    const qaId = (json?.qaId ?? "").toString();
    const published = json?.published === false ? false : true;
    if (!qaId) return NextResponse.json({ error: "Missing qaId" }, { status: 400 });

    const ok = await withConn(async (c) => {
      const r = await c.query(`select id, created_by from qa_entries where id = $1`, [qaId]);
      const row = r.rows?.[0];
      if (!row) return false;
      if (row.created_by !== userId) return false;
      await c.query(`update qa_entries set published = $2 where id = $1`, [qaId, published]);
      return true;
    });
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ ok: true, published });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
