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

    // Load nodes with helpful aggregates and my vote, filter by published or owner
    const nodes = await withConn(async (c) => {
      const r = await c.query(
        `select q.id, q.parent_id, q.question, q.answer, q.summary, q.created_by,
                coalesce(sum(case when f.vote = 1 then 1 else 0 end),0) as helpful,
                coalesce(sum(case when f.vote = -1 then 1 else 0 end),0) as unhelpful,
                max(case when f.user_id = $2 then f.vote else null end) as my_vote
         from qa_entries q
         left join qa_feedback f on f.qa_id = q.id
         where q.root_id = $1 and (q.published = true or q.created_by = $2)
         group by q.id
         order by q.created_at asc`,
        [rootId, userId]
      );
      return r.rows as Array<{ id: string; parent_id: string | null; question: string; answer: string | null; summary: string | null; created_by: string | null; helpful: string; unhelpful: string; my_vote: number | null }>;
    });

    const idSet = new Set(nodes.map((n) => n.id));

    // Cross-root relations: always include edges touching the focused qaId, and load missing nodes
    let crossRels: Array<{ source_id: string; target_id: string; type: string; weight: number; synthetic: boolean }> = [];
    if (qaIdParam) {
      const direct = await withConn(async (c) => {
        const r = await c.query(
          `select source_id, target_id, type, weight
             from qa_relations
            where source_id = $1 or target_id = $1`,
          [qaIdParam]
        );
        return r.rows as Array<{ source_id: string; target_id: string; type: string; weight: number }>;
      });
      // Find nodes missing from current idSet
      const missingIds = new Set<string>();
      for (const e of direct) {
        if (!idSet.has(e.source_id)) missingIds.add(e.source_id);
        if (!idSet.has(e.target_id)) missingIds.add(e.target_id);
      }
      // Remove focus id if already present
      missingIds.delete(qaIdParam);
      // Load missing node details with visibility rules
      if (missingIds.size > 0) {
        const extra = await withConn(async (c) => {
          const r = await c.query(
            `select id, question, answer, summary
               from qa_entries
              where id = any($1) and (published = true or created_by = $2)`,
            [Array.from(missingIds), userId]
          );
          return r.rows as Array<{ id: string; question: string; answer: string | null; summary: string | null }>;
        });
        for (const n of extra) {
          idSet.add(n.id);
          nodes.push({
            id: n.id,
            parent_id: null,
            question: n.question,
            answer: n.answer,
            summary: n.summary,
            created_by: null,
            helpful: '0',
            unhelpful: '0',
            my_vote: 0,
          } as any);
        }
      }
      crossRels = direct.map((e) => ({ ...e, synthetic: false }));
    }

    const rels = await withConn(async (c) => {
      const r = await c.query(
        `select source_id, target_id, type, weight, false as synthetic
           from qa_relations
          where source_id = any($1) or target_id = any($1)`,
        [Array.from(idSet)]
      );
      return r.rows as Array<{ source_id: string; target_id: string; type: string; weight: number; synthetic: boolean }>;
    });

    // Expand by one-hop neighbors for any edges adjacent to nodes we already included
    // This allows center-created edges on connected nodes (not directly touching qaId) to show up on the left map
    {
      const neighborMissing = new Set<string>();
      for (const e of rels) {
        if (!idSet.has(e.source_id)) neighborMissing.add(e.source_id);
        if (!idSet.has(e.target_id)) neighborMissing.add(e.target_id);
      }
      if (qaIdParam) neighborMissing.delete(qaIdParam);
      if (neighborMissing.size > 0) {
        const extra2 = await withConn(async (c) => {
          const r = await c.query(
            `select id, question, answer, summary
               from qa_entries
              where id = any($1) and (published = true or created_by = $2)`,
            [Array.from(neighborMissing), userId]
          );
          return r.rows as Array<{ id: string; question: string; answer: string | null; summary: string | null }>;
        });
        for (const n of extra2) {
          if (!idSet.has(n.id)) {
            idSet.add(n.id);
            nodes.push({
              id: n.id,
              parent_id: null,
              question: n.question,
              answer: n.answer,
              summary: n.summary,
              created_by: null,
              helpful: '0',
              unhelpful: '0',
              my_vote: 0,
            } as any);
          }
        }
      }
    }

    const synthetics = await withConn(async (c) => {
      const r = await c.query(
        `select parent_id as source_id, id as target_id, 'precedes' as type, 1 as weight, true as synthetic
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
      summary: n.summary ?? undefined,
      answer: (n.answer ? String(n.answer).replace(/\s+/g, " ").slice(0, 200) : undefined),
      helpful: Number(n.helpful || 0),
      unhelpful: Number(n.unhelpful || 0),
      myVote: n.my_vote === 1 ? 1 : n.my_vote === -1 ? -1 : 0,
    }));

    // Normalize legacy relation types → canonical
    const canon = (t: string) => {
      const s = (t || "").toLowerCase();
      if (s === "follows_from") return "precedes";
      if (s === "refines") return "elaborates";
      if (s === "depends_on") return "prerequisite";
      return s;
    };
    const normRels = rels.map((e) => ({ ...e, type: canon(e.type) }));
    const normCross = crossRels.map((e) => ({ ...e, type: canon(e.type) }));
    const merged = [...normRels, ...synthetics, ...normCross].filter((e) => idSet.has(e.source_id) && idSet.has(e.target_id));
    const byKey = new Map<string, { source_id: string; target_id: string; type: string; weight: number; synthetic: boolean }>();
    for (const e of merged) {
      const key = `${e.source_id}|${e.target_id}|${e.type}`;
      const existing = byKey.get(key);
      if (!existing || (existing.synthetic && !e.synthetic)) byKey.set(key, e);
    }
    const mapEdges = Array.from(byKey.values()).map((e) => ({ sourceId: e.source_id, targetId: e.target_id, type: e.type, weight: e.weight, synthetic: !!e.synthetic }));

    return NextResponse.json({ nodes: mapNodes, edges: mapEdges, rootId });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
