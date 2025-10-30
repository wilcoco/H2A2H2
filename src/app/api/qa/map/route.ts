import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const url = new URL(req.url);
    let rootId = url.searchParams.get("rootId")?.toString() || null;
    const qaIdParam = url.searchParams.get("qaId")?.toString() || null;

    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;

    if (!rootId && qaIdParam) {
      const row = await withConn(async (c) => {
        const r = await c.query(`select id, root_id from qa_entries where id = $1`, [qaIdParam]);
        return r.rows?.[0] ?? null;
      });
      if (!row) return NextResponse.json({ error: "qa not found" }, { status: 404 });
      rootId = row.root_id || row.id;
    }

    if (!rootId) return NextResponse.json({ error: "Missing rootId or qaId" }, { status: 400 });

    // Load nodes with helpful aggregates and my vote
    const nodes = await withConn(async (c) => {
      const r = await c.query(
        `select q.id, q.parent_id, q.question, q.answer,
                coalesce(sum(case when f.vote = 1 then 1 else 0 end),0) as helpful,
                coalesce(sum(case when f.vote = -1 then 1 else 0 end),0) as unhelpful,
                max(case when f.user_id = $2 then f.vote else null end) as my_vote
         from qa_entries q
         left join qa_feedback f on f.qa_id = q.id
         where q.root_id = $1
         group by q.id
         order by q.created_at asc`,
        [rootId, userId]
      );
      return r.rows as Array<{ id: string; parent_id: string | null; question: string; answer: string | null; helpful: string; unhelpful: string; my_vote: number | null }>;
    });

    const idSet = new Set(nodes.map((n) => n.id));

    const rels = await withConn(async (c) => {
      const r = await c.query(
        `select source_id, target_id, type, weight, false as synthetic
           from qa_relations
          where source_id = any($1) or target_id = any($1)`,
        [Array.from(idSet)]
      );
      return r.rows as Array<{ source_id: string; target_id: string; type: string; weight: number; synthetic: boolean }>;
    });

    const synthetics = await withConn(async (c) => {
      const r = await c.query(
        `select parent_id as source_id, id as target_id, 'follows_from' as type, 1 as weight, true as synthetic
           from qa_entries
          where root_id = $1 and parent_id is not null`,
        [rootId]
      );
      return r.rows as Array<{ source_id: string; target_id: string; type: string; weight: number; synthetic: boolean }>;
    });

    const mapNodes = nodes.map((n) => ({
      id: n.id,
      question: n.question,
      hasAnswer: !!n.answer,
      helpful: Number(n.helpful || 0),
      unhelpful: Number(n.unhelpful || 0),
      myVote: n.my_vote === 1 ? 1 : n.my_vote === -1 ? -1 : 0,
    }));

    const mapEdges = [...rels, ...synthetics]
      .filter((e) => idSet.has(e.source_id) && idSet.has(e.target_id))
      .map((e) => ({ sourceId: e.source_id, targetId: e.target_id, type: e.type, weight: e.weight, synthetic: !!e.synthetic }));

    return NextResponse.json({ nodes: mapNodes, edges: mapEdges, rootId });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
