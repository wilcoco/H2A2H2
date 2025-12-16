import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const url = new URL(req.url);
    const teamId = (url.searchParams.get("teamId") || "").trim();
    const userEmail = (url.searchParams.get("userEmail") || "").trim();
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 50)));
    const rows = await withConn(async (c) => {
      const conds: string[] = [];
      const params: unknown[] = [];
      if (teamId) { conds.push(`l.team_id = $${params.length + 1}`); params.push(teamId); }
      if (userEmail) { conds.push(`l.user_email = $${params.length + 1}`); params.push(userEmail); }
      const where = conds.length > 0 ? `where ${conds.join(" and ")}` : "";
      const sql = `
        select l.id, l.title, l.content, l.team_id, t.name as team_name, l.user_email, l.user_name, l.created_at
        from work_logs l
        left join teams t on t.id = l.team_id
        ${where}
        order by l.created_at desc
        limit ${limit}
      `;
      const r = await c.query(sql, params);
      return r.rows as any[];
    });
    const items = rows.map((r) => ({
      id: String(r.id || ""),
      title: String(r.title || ""),
      content: String(r.content || ""),
      teamId: typeof r.team_id === 'string' ? r.team_id : undefined,
      teamName: typeof r.team_name === 'string' ? r.team_name : undefined,
      userEmail: typeof r.user_email === 'string' ? r.user_email : undefined,
      userName: typeof r.user_name === 'string' ? r.user_name : undefined,
      createdAt: String(r.created_at || ""),
    }));
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: "Failed to load work logs" }, { status: 500 });
  }
}
