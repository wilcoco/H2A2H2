import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { z } from "zod";
import { randomUUID } from "crypto";
import { passes as measurementPasses, type Measurement, type Direction } from "@/lib/nightwish/verification";
import { touchContribution } from "@/lib/nightwish/contribution";

export const runtime = "nodejs";

const Body = z.object({
  qaId: z.string().min(1),
  metric: z.string().min(1).max(120),
  baseline: z.number(),
  observed: z.number(),
  unit: z.string().max(40).optional(),
  direction: z.enum(["higher_better", "lower_better"]).optional(),
  minRelImprovement: z.number().min(0).max(10).optional(),
  sourceUrl: z.string().max(500).optional(),
  sourceNote: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const json = await req.json();
    const input = Body.parse(json);
    const direction: Direction = input.direction ?? "higher_better";
    const measurement: Measurement = {
      metric: input.metric,
      baseline: input.baseline,
      observed: input.observed,
      direction,
      unit: input.unit,
      minRelImprovement: input.minRelImprovement ?? 0,
    };
    const pass = measurementPasses(measurement);
    const id = randomUUID();

    await withConn(async (c) => {
      await c.query(
        `insert into qa_verifications
           (id, qa_id, metric, baseline, observed, unit, direction, min_rel_improvement, source_url, source_note, verified_by, passes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, input.qaId, input.metric, input.baseline, input.observed, input.unit ?? null, direction, input.minRelImprovement ?? 0, input.sourceUrl ?? null, input.sourceNote ?? null, user.email, pass]
      );
    });

    try { await touchContribution(user.email, input.qaId); } catch {}

    return NextResponse.json({ id, passes: pass });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const url = new URL(req.url);
    const qaId = url.searchParams.get("qaId");
    const rootId = url.searchParams.get("rootId");
    if (!qaId && !rootId) return NextResponse.json({ items: [], branchVerified: false });

    const items = await withConn(async (c) => {
      if (rootId) {
        // 가지 전체 (root_id 트리에 있는 모든 노드의 검증)
        const r = await c.query(
          `select v.*, e.id as node_id
             from qa_verifications v
             join qa_entries e on e.id = v.qa_id
            where coalesce(e.root_id, e.id) = $1
            order by v.created_at desc`,
          [rootId]
        );
        return r.rows;
      }
      const r = await c.query(
        `select * from qa_verifications where qa_id = $1 order by created_at desc`,
        [qaId]
      );
      return r.rows;
    });

    const branchVerified = items.some((it: { passes?: boolean }) => Boolean(it.passes));
    return NextResponse.json({ items, branchVerified });
  } catch {
    return NextResponse.json({ items: [], branchVerified: false });
  }
}
