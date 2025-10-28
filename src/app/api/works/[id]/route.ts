import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureTables();
    const id = params?.id;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const row = await withConn(async (c) => {
      const q = await c.query(
        `select id, title, description, node_count, investment_score, created_by, created_at, graph, topic, is_public from works where id = $1`,
        [id]
      );
      return q.rows?.[0] ?? null;
    });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const graph = (row.graph as any) ?? { nodes: [], edges: [] };
    return NextResponse.json({
      work: {
        id: row.id,
        title: row.title,
        description: row.description ?? undefined,
        nodeCount: Number(row.node_count ?? 0),
        investmentScore: Number(row.investment_score ?? 0),
        createdBy: row.created_by ?? undefined,
        createdAt: row.created_at,
        topic: row.topic ?? undefined,
        isPublic: Boolean(row.is_public ?? true),
      },
      graph,
    });
  } catch (e) {
    return NextResponse.json({ error: "Failed to load work" }, { status: 500 });
  }
}
