import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const url = new URL(req.url);
    const teamId = url.searchParams.get("teamId") || "";
    const rows = await withConn(async (c) => {
      if (teamId) {
        const r = await c.query(
          `select user_email, coalesce(user_name, user_email) as user_name from team_members where team_id = $1 order by user_name asc`,
          [teamId]
        );
        return r.rows as { user_email?: unknown; user_name?: unknown }[];
      } else {
        const r = await c.query(
          `select user_email, max(user_name) as user_name from team_members group by user_email order by max(user_name) asc`
        );
        return r.rows as { user_email?: unknown; user_name?: unknown }[];
      }
    });
    const items = rows
      .map((r) => ({ email: typeof r.user_email === 'string' ? r.user_email : '', name: typeof r.user_name === 'string' ? r.user_name : '' }))
      .filter((m) => m.email);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
  }
}
