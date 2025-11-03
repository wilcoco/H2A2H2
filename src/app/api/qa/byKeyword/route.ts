import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = await req.json().catch(() => ({}));
    const token = (req as any).cookies?.get?.("session")?.value ?? undefined;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;

    const keyword: string | undefined = body?.keyword ? String(body.keyword) : undefined;
    const keywords: string[] = Array.isArray(body?.keywords) ? body.keywords.map((s: any) => String(s)).filter(Boolean) : [];
    const mode: "any" | "all" = (body?.mode === "all" ? "all" : "any");
    const limit: number = Math.min(Math.max(Number(body?.limit ?? 10), 1), 25);

    const kws = (keyword ? [keyword] : keywords).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (kws.length === 0) return NextResponse.json({ items: [], keywords: {} });

    let rows: Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string }> = [];
    if (kws.length === 1 || mode === "any") {
      // ANY match
      rows = await withConn(async (c) => {
        const r = await c.query(
          `select e.id, e.question, e.answer, e.summary, e.work_id
             from qa_entries e
             join qa_keywords k on k.qa_id = e.id
            where k.keyword = any($1)
              and (e.published = true or e.created_by = $3)
            group by e.id
            order by e.created_at desc
            limit $2`,
          [kws, limit, userId]
        );
        return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string }>;
      });
    } else {
      // ALL match: having count(distinct keyword) = kws.length
      rows = await withConn(async (c) => {
        const r = await c.query(
          `select e.id, e.question, e.answer, e.summary, e.work_id
             from qa_entries e
             join qa_keywords k on k.qa_id = e.id
            where k.keyword = any($1)
              and (e.published = true or e.created_by = $3)
            group by e.id
            having count(distinct k.keyword) >= $4
            order by e.created_at desc
            limit $2`,
          [kws, limit, userId, kws.length]
        );
        return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string }>;
      });
    }

    // Attach keywords for returned ids
    const ids = rows.map((r) => r.id);
    let kmap: Record<string, string[]> = {};
    if (ids.length > 0) {
      const loaded = await withConn(async (c) => {
        const r = await c.query(`select qa_id, keyword from qa_keywords where qa_id = any($1)`, [ids]);
        return r.rows as Array<{ qa_id: string; keyword: string }>;
      });
      const out = new Map<string, string[]>();
      for (const { qa_id, keyword } of loaded) {
        if (!out.has(qa_id)) out.set(qa_id, []);
        out.get(qa_id)!.push(keyword);
      }
      kmap = Object.fromEntries(ids.map((id) => [id, (out.get(id) || []).slice(0, 8)]));
    }

    const items = rows.map((r) => ({ id: r.id, question: r.question, answer: r.answer ?? undefined, summary: r.summary ?? undefined, workId: r.work_id ?? undefined }));
    return NextResponse.json({ items, keywords: kmap });
  } catch (e) {
    return NextResponse.json({ items: [], keywords: {} });
  }
}
