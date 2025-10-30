import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set(["follows_from","refines","clarifies","depends_on","alternative"]);

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const sourceId: string = (body?.sourceId ?? "").toString();
    const targetId: string = (body?.targetId ?? "").toString();
    const type: string = (body?.type ?? "").toString();
    const weightNum = Number(body?.weight ?? 1);
    const weight = Number.isFinite(weightNum) ? Math.max(1, Math.min(9, Math.trunc(weightNum))) : 1;

    if (!sourceId || !targetId || !type) return NextResponse.json({ error: "Missing params" }, { status: 400 });
    if (sourceId === targetId) return NextResponse.json({ error: "source==target" }, { status: 400 });
    if (!ALLOWED_TYPES.has(type)) return NextResponse.json({ error: "Invalid type" }, { status: 400 });

    const ok = await withConn(async (c) => {
      const a = await c.query(`select 1 from qa_entries where id = $1`, [sourceId]);
      const b = await c.query(`select 1 from qa_entries where id = $1`, [targetId]);
      if (!a.rows?.[0] || !b.rows?.[0]) return false;
      await c.query(
        `insert into qa_relations (source_id, target_id, type, weight, created_by)
         values ($1,$2,$3,$4,$5)
         on conflict (source_id, target_id, type)
         do update set weight = excluded.weight, created_by = excluded.created_by, created_at = now()`,
        [sourceId, targetId, type, weight, user.email]
      );
      return true;
    });
    if (!ok) return NextResponse.json({ error: "QA not found" }, { status: 404 });
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
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const sourceId: string = (body?.sourceId ?? "").toString();
    const targetId: string = (body?.targetId ?? "").toString();
    const type: string = (body?.type ?? "").toString();
    if (!sourceId || !targetId || !type) return NextResponse.json({ error: "Missing params" }, { status: 400 });

    await withConn(async (c) => {
      await c.query(`delete from qa_relations where source_id = $1 and target_id = $2 and type = $3`, [sourceId, targetId, type]);
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
