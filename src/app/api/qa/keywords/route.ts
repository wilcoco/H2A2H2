import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function heuristic(text: string, max = 8): string[] {
  const stop = new Set([
    // English
    "the","a","an","and","or","of","to","in","on","for","with","is","are","was","were","be","as","by","at","from","that","this","it","we","you","they","i","how","what","why","when","where",
    // Korean (basic)
    "은","는","이","가","을","를","에","의","도","과","와","들","에서","하다","했다","인가","인데","하면","하려고","어떻게","무엇","왜","언제","어디",
  ]);
  const tokens = (text || "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !stop.has(t));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return sorted.slice(0, max);
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = await req.json().catch(() => ({}));
    let qaIds: string[] = Array.isArray(body?.qaIds) ? body.qaIds.map((s: any) => String(s)).filter(Boolean) : [];
    const singleId = body?.qaId ? String(body.qaId) : "";
    if (!qaIds.length && singleId) qaIds = [singleId];
    const max = Math.max(1, Math.min(10, Number(body?.max ?? 8)));
    const force = body?.force === true;
    if (!qaIds.length) return NextResponse.json({ results: {} });

    // Load existing
    const existing = await withConn(async (c) => {
      const r = await c.query(`select qa_id, keyword from qa_keywords where qa_id = any($1)`, [qaIds]);
      return r.rows as Array<{ qa_id: string; keyword: string }>;
    });
    const existingMap = new Map<string, string[]>();
    for (const { qa_id, keyword } of existing) {
      if (!existingMap.has(qa_id)) existingMap.set(qa_id, []);
      existingMap.get(qa_id)!.push(keyword);
    }

    // Determine which need generation
    const need = qaIds.filter((id) => force || !(existingMap.get(id)?.length));
    if (need.length) {
      const texts = await withConn(async (c) => {
        const r = await c.query(
          `select id, coalesce(nullif(summary, ''), nullif(answer, ''), question) as text from qa_entries where id = any($1)`,
          [need]
        );
        return r.rows as Array<{ id: string; text: string | null }>;
      });
      // Generate heuristics and upsert
      await withConn(async (c) => {
        for (const { id, text } of texts) {
          const kws = heuristic(String(text || ""), max);
          for (let i = 0; i < kws.length; i++) {
            const kw = kws[i];
            await c.query(
              `insert into qa_keywords (qa_id, keyword, weight) values ($1,$2,$3)
               on conflict (qa_id, keyword) do update set weight = excluded.weight`,
              [id, kw, Math.max(1, Math.min(9, i + 1))]
            );
          }
        }
      });
      // Reload existing after insert
      const after = await withConn(async (c) => {
        const r = await c.query(`select qa_id, keyword from qa_keywords where qa_id = any($1)`, [qaIds]);
        return r.rows as Array<{ qa_id: string; keyword: string }>;
      });
      existingMap.clear();
      for (const { qa_id, keyword } of after) {
        if (!existingMap.has(qa_id)) existingMap.set(qa_id, []);
        existingMap.get(qa_id)!.push(keyword);
      }
    }

    const results: Record<string, string[]> = {};
    for (const id of qaIds) results[id] = (existingMap.get(id) || []).slice(0, max);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ results: {} });
  }
}
