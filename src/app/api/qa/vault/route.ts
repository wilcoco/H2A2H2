import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vault tree (좌측 사이드바용). 루트별로 그룹화된 가지 구조.
// scope: "mine" (내 것만) | "public" (전체 공개) | "stake" (내가 스테이크 건 가지)

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const url = new URL(req.url);
    const scope = (url.searchParams.get("scope") || "public") as "mine" | "public" | "stake";

    const result = await withConn(async (c) => {
      let qaRows: Array<{ id: string; question: string; summary: string | null; root_id: string | null; parent_id: string | null; status: string | null; forked_from: string | null; created_by: string | null; created_at: string }>;
      if (scope === "mine") {
        if (!user?.email) return { branches: [], scope, count: 0 };
        const r = await c.query(
          `select id, question, summary, root_id, parent_id, status, forked_from, created_by, created_at
             from qa_entries where created_by = $1 and published = true
             order by created_at asc limit 500`,
          [user.email]
        );
        qaRows = r.rows as typeof qaRows;
      } else if (scope === "stake") {
        if (!user?.email) return { branches: [], scope, count: 0 };
        const r = await c.query(
          `select e.id, e.question, e.summary, e.root_id, e.parent_id, e.status, e.forked_from, e.created_by, e.created_at
             from qa_entries e
            where e.published = true
              and coalesce(e.root_id, e.id) in (
                select distinct qa_root_id from stake_ledger where user_id = $1
              )
             order by e.created_at asc limit 500`,
          [user.email]
        );
        qaRows = r.rows as typeof qaRows;
      } else {
        const r = await c.query(
          `select id, question, summary, root_id, parent_id, status, forked_from, created_by, created_at
             from qa_entries where published = true
             order by created_at desc limit 200`
        );
        qaRows = r.rows as typeof qaRows;
      }

      // 검증 통과 여부 (가지별)
      const ids = qaRows.map((r) => r.id);
      const rootIds = Array.from(new Set(qaRows.map((r) => r.root_id || r.id)));
      let verifiedRoots = new Set<string>();
      if (rootIds.length > 0) {
        const v = await c.query(
          `select coalesce(e.root_id, e.id) as root_id
             from qa_verifications v join qa_entries e on e.id = v.qa_id
            where v.passes = true and coalesce(e.root_id, e.id) = any($1)
            group by coalesce(e.root_id, e.id)`,
          [rootIds]
        );
        verifiedRoots = new Set((v.rows as Array<{ root_id: string }>).map((x) => x.root_id));
      }

      // 가지(root별 그룹) 구조로
      const byRoot = new Map<string, typeof qaRows>();
      for (const q of qaRows) {
        const rid = q.root_id || q.id;
        if (!byRoot.has(rid)) byRoot.set(rid, []);
        byRoot.get(rid)!.push(q);
      }
      const branches = Array.from(byRoot.entries()).map(([rid, nodes]) => {
        const root = nodes.find((n) => n.id === rid) || nodes[0];
        return {
          rootId: rid,
          rootQuestion: root.question,
          createdBy: root.created_by,
          createdAt: root.created_at,
          nodeCount: nodes.length,
          verified: verifiedRoots.has(rid),
          dormant: nodes.every((n) => n.status === "dormant"),
          hasFork: nodes.some((n) => !!n.forked_from),
          nodes: nodes.map((n) => ({
            id: n.id,
            question: n.question,
            summary: n.summary,
            parentId: n.parent_id,
            forkedFrom: n.forked_from,
            status: n.status || "active",
            createdBy: n.created_by,
            createdAt: n.created_at,
          })),
        };
      }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return { branches, scope, count: qaRows.length };
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ branches: [], scope: "public", count: 0 });
  }
}
