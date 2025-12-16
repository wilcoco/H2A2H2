import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    await ensureTables();
    const rows = await withConn(async (c) => {
      const r = await c.query(`select id, name from teams order by name asc`);
      return r.rows as { id?: unknown; name?: unknown }[];
    });
    const items = rows
      .map((r) => ({ id: typeof r.id === 'string' ? r.id : '', name: typeof r.name === 'string' ? r.name : '' }))
      .filter((t) => t.id && t.name);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: "Failed to load teams" }, { status: 500 });
  }
}
