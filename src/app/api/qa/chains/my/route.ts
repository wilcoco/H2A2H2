import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

    const rows = await withConn(async (c) => {
      const sql = `
        with mine_entries as (
          select coalesce(e.root_id, e.id) as rid, count(*)::bigint as my_nodes
          from qa_entries e
          where e.created_by = $1
          group by coalesce(e.root_id, e.id)
        ),
        mine_relations as (
          select coalesce(coalesce(es.root_id, es.id), coalesce(et.root_id, et.id)) as rid, count(*)::bigint as my_rels
          from qa_relations r
          left join qa_entries es on es.id = r.source_id
          left join qa_entries et on et.id = r.target_id
          where r.created_by = $1
          group by coalesce(coalesce(es.root_id, es.id), coalesce(et.root_id, et.id))
        ),
        roots as (
          select rid, sum(my_nodes)::bigint as my_nodes, sum(my_rels)::bigint as my_rels
          from (
            select rid, my_nodes, 0::bigint as my_rels from mine_entries
            union all
            select rid, 0::bigint as my_nodes, my_rels from mine_relations
          ) u
          group by rid
        ),
        firsts as (
          select coalesce(root_id, id) as rid, min(created_at) as first_created_at
          from qa_entries
          group by coalesce(root_id, id)
        )
        select r.rid as root_id,
               case when q.published = false and coalesce(q.created_by, '') <> $1 then null else q.question end as root_question,
               coalesce(r.my_nodes,0)::bigint as my_nodes,
               coalesce(r.my_rels,0)::bigint as my_rels,
               f.first_created_at
        from roots r
        join qa_entries q on q.id = r.rid
        left join firsts f on f.rid = r.rid
        order by f.first_created_at desc nulls last
        limit $2 offset $3`;
      const r = await c.query(sql, [userId, limit, offset]);
      return r.rows as Array<{ root_id: string; root_question: string | null; my_nodes: string | number | null; my_rels: string | number | null; first_created_at: string | null }>;
    });

    return NextResponse.json({
      items: rows.map((x) => ({
        rootId: x.root_id,
        question: x.root_question || undefined,
        myNodes: Number(x.my_nodes || 0),
        myRels: Number(x.my_rels || 0),
        firstCreatedAt: x.first_created_at || undefined,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
