import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const url = new URL(req.url);
    const rootId = url.searchParams.get("rootId")?.toString();
    const depth = Math.max(1, Math.min(6, Number(url.searchParams.get("depth") ?? 3)));
    if (!rootId) return NextResponse.json({ error: "Missing rootId" }, { status: 400 });

    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;

    const rows = await withConn(async (c) => {
      const r = await c.query(
        `select q.id, q.parent_id, q.root_id, q.question, q.answer, q.created_at, q.last_response_id,
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
      return r.rows as Array<{ id: string; parent_id: string | null; root_id: string | null; question: string; answer: string | null; created_at: string; last_response_id?: string | null; helpful: string; unhelpful: string; my_vote: number | null }>;
    });

    const byId = new Map<string, any>();
    rows.forEach((r) => {
      byId.set(r.id, {
        id: r.id,
        parentId: r.parent_id ?? undefined,
        question: r.question,
        hasAnswer: !!r.answer,
        lastResponseId: r.last_response_id ?? undefined,
        helpful: Number(r.helpful || 0),
        unhelpful: Number(r.unhelpful || 0),
        myVote: r.my_vote === 1 ? 1 : r.my_vote === -1 ? -1 : 0,
        children: [] as any[],
      });
    });

    const root = byId.get(rootId) || null;
    if (!root) return NextResponse.json({ error: "Root not found" }, { status: 404 });

    // build tree
    rows.forEach((r) => {
      if (!r.parent_id) return;
      const n = byId.get(r.id);
      const p = byId.get(r.parent_id);
      if (n && p) p.children.push(n);
    });

    // compute depth-pruned tree (BFS)
    const queue: Array<{ node: any; d: number }> = [{ node: root, d: 1 }];
    const visited = new Set<string>();
    while (queue.length) {
      const { node, d } = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      if (d >= depth) {
        // prune deeper children
        node.children = [];
        continue;
      }
      for (const ch of node.children) queue.push({ node: ch, d: d + 1 });
    }

    return NextResponse.json({ root });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
