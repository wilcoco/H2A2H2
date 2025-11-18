import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
    if (!url) {
      return NextResponse.json({ ok: false, error: "Missing DATABASE_URL/POSTGRES_URL" }, { status: 500 });
    }
    const u = new URL(url);
    const info = {
      protocol: u.protocol.replace(":", ""),
      host: u.hostname,
      port: u.port || "5432",
      database: u.pathname.replace(/^\//, ""),
    };

    await ensureTables();
    const rows = await withConn(async (c) => {
      const r = await c.query("select current_database() as db, current_user as user, version() as version");
      return r.rows?.[0] ?? null;
    });

    return NextResponse.json({ ok: true, target: info, server: rows });
  } catch (e) {
    console.error("/api/db/health error", e);
    return NextResponse.json({ ok: false, error: (e as Error)?.message || "Unknown" }, { status: 500 });
  }
}
