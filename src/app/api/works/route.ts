import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

type Row = {
  id: string;
  title: string;
  description: string | null;
  node_count: number | null;
  investment_score: number | null;
  created_by: string | null;
  created_at: Date;
};

const NodeType = z.enum([
  "concept",
  "claim",
  "evidence",
  "source",
  "qa",
  "premise",
  "inference",
  "conclusion",
]);
const EdgeType = z.enum(["supports", "refutes", "relates_to", "cites", "infers"]);
const NodeT = z.object({
  id: z.string(),
  type: NodeType,
  title: z.string(),
  content: z.string().optional(),
  score: z.number().optional(),
});
const EdgeT = z.object({
  id: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  type: EdgeType,
  score: z.number().optional(),
});
const GraphT = z.object({ nodes: z.array(NodeT), edges: z.array(EdgeT) });
const CreateBody = z.object({ title: z.string().min(1), description: z.string().optional(), topic: z.string().optional(), isPublic: z.boolean().optional(), graph: GraphT });

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const url = new URL(req.url);
    const kw = url.searchParams.get("kw")?.trim();
    const search = url.searchParams.get("search")?.trim();
    const rows = await withConn(async (c) => {
      if (kw && kw.length > 0) {
        const terms = kw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .slice(0, 10);
        if (terms.length > 0) {
          const pats = terms.map((t) => `%${t}%`);
          const titleExpr = `(${pats.map((_, i) => `title ilike $${i + 1}`).join(" or ")})`;
          const descExpr = `(${pats.map((_, i) => `coalesce(description,'') ilike $${i + 1}`).join(" or ")})`;
          const topicExpr = `(${pats.map((_, i) => `coalesce(topic,'') ilike $${i + 1}`).join(" or ")})`;
          const sql = `select id, title, description, node_count, investment_score, created_by, created_at
                       from works
                       where is_public = true and ( ${titleExpr} or ${descExpr} or ${topicExpr} )
                       order by created_at desc limit 100`;
          const q = await c.query<Row>(sql, pats);
          return q.rows;
        }
      }
      if (search && search.length > 0) {
        const q = await c.query<Row>(
          `select id, title, description, node_count, investment_score, created_by, created_at
           from works
           where is_public = true and (title ilike $1 or coalesce(description,'') ilike $1 or coalesce(topic,'') ilike $1)
           order by created_at desc limit 100`,
          ["%" + search + "%"]
        );
        return q.rows;
      }
      const q = await c.query<Row>(
        `select id, title, description, node_count, investment_score, created_by, created_at
         from works
         where is_public = true
         order by created_at desc limit 100`
      );
      return q.rows;
    });
    return NextResponse.json({
      works: rows.map((r: Row) => ({
        id: r.id,
        title: r.title,
        description: r.description ?? undefined,
        investmentScore: Number(r.investment_score ?? 0),
        nodeCount: Number(r.node_count ?? 0),
        createdBy: r.created_by ?? undefined,
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: "Failed to load works" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const json = await req.json();
    const input = CreateBody.parse(json);
    const id = `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const nodeCount = input.graph.nodes.length;
    await withConn((c) => c.query(
      `insert into works (id, title, description, node_count, investment_score, created_by, graph, topic, is_public) values ($1,$2,$3,$4,0,$5,$6,$7,$8)`,
      [id, input.title, input.description ?? null, nodeCount, user.email, JSON.stringify(input.graph), input.topic ?? null, input.isPublic ?? true]
    ));
    return NextResponse.json({
      work: {
        id,
        title: input.title,
        description: input.description ?? undefined,
        nodeCount,
        investmentScore: 0,
        createdBy: user.email,
        topic: input.topic ?? undefined,
        isPublic: input.isPublic ?? true,
      }
    });
  } catch (e) {
    return NextResponse.json({ error: "Failed to create work" }, { status: 500 });
  }
}
