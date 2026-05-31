// 한 정리 페이지를 *참조하는* 다른 페이지들 (incoming wikilinks).
// /api/qa/organize/backlinks?id=org_xxx

import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ items: [] });

    const rows = await withConn(async (c) => {
      const r = await c.query(
        `select l.source_page_id as source_id, l.surface_text, l.created_at,
                p.title as source_title, p.summary_line as source_summary,
                p.organized_by as source_owner
           from organized_links l
           join organized_pages p on p.id = l.source_page_id
          where l.target_page_id = $1
          order by l.created_at desc
          limit 50`,
        [id]
      );
      return r.rows as unknown as Array<{
        source_id: string; surface_text: string | null; created_at: string;
        source_title: string; source_summary: string; source_owner: string;
      }>;
    });

    const items = rows.map((r) => ({
      sourceId: r.source_id,
      sourceTitle: r.source_title,
      sourceSummary: r.source_summary,
      sourceOwner: r.source_owner,
      surfaceText: r.surface_text,
      createdAt: r.created_at,
    }));

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
