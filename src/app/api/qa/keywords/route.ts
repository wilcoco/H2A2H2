import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function heuristic(text: string, max = 8): string[] {
  const stop = new Set([
    "the","a","an","and","or","of","to","in","on","for","with","is","are","was","were","be","as","by","at","from","that","this","it","we","you","they","i","how","what","why","when","where",
    "은","는","이","가","을","를","에","의","도","과","와","들","에서","하다","했다","인가","인데","하면","하려고","어떻게","무엇","왜","언제","어디",
  ]);
  function normalizeKo(s: string): string {
    const t = (s || "").trim().toLowerCase();
    if (!t) return t;
    const josa = [
      "에서","에게","으로","하면","하며","라고","이라면","이랑","처럼","부터","까지","조차","마저","뿐","이라서","라서","이라며","이며",
      "은","는","이","가","을","를","과","와","로","에","도","만","나","이나","라도","라면","랑","엔","의"
    ];
    for (const j of josa.sort((a,b) => b.length - a.length)) {
      if (t.endsWith(j) && t.length > j.length + 1) return t.slice(0, t.length - j.length);
    }
    return t;
  }
  const raw = (text || "").toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").split(/\s+/);
  const tokens = raw.map((w) => normalizeKo(w)).filter((t) => t.length >= 2 && !stop.has(t));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const out: string[] = [];
  for (const t of sorted) { if (!out.includes(t)) out.push(t); if (out.length >= max) break; }
  return out;
}

function phraseHeuristic(text: string, max = 6): string[] {
  function normalizeKoToken(s: string): string {
    const t = (s || "").trim().toLowerCase();
    if (!t) return t;
    const josa = [
      "에서","에게","으로","하면","하며","라고","이라면","이랑","처럼","부터","까지","조차","마저","뿐","이라서","라서","이라며","이며",
      "은","는","이","가","을","를","과","와","로","에","도","만","나","이나","라도","라면","랑","엔","의"
    ];
    for (const j of josa.sort((a,b) => b.length - a.length)) {
      if (t.endsWith(j) && t.length > j.length + 1) return t.slice(0, t.length - j.length);
    }
    return t;
  }
  const tokens = (text || "").toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").split(/\s+/).filter(Boolean).map(normalizeKoToken).filter((t) => t.length >= 2);
  const grams: string[] = [];
  const maxN = 4;
  for (let n = 2; n <= Math.min(maxN, tokens.length); n++) {
    for (let i = 0; i + n <= tokens.length; i++) grams.push(tokens.slice(i, i + n).join(" "));
  }
  const freq = new Map<string, number>();
  for (const g of grams) freq.set(g, (freq.get(g) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const out: string[] = [];
  for (const t of sorted) { if (!out.includes(t)) out.push(t); if (out.length >= max) break; }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = await req.json().catch(() => ({}));
    let qaIds: string[] = Array.isArray(body?.qaIds) ? body.qaIds.map((s: unknown) => String(s)).filter(Boolean) : [];
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
      // Generate heuristics (words + phrases) and upsert
      await withConn(async (c) => {
        for (const { id, text } of texts) {
          const base = String(text || "");
          const words = heuristic(base, max);
          const phrases = phraseHeuristic(base, Math.min(6, max));
          for (let i = 0; i < words.length; i++) {
            const kw = words[i];
            await c.query(
              `insert into qa_keywords (qa_id, keyword, weight) values ($1,$2,$3)
               on conflict (qa_id, keyword) do update set weight = excluded.weight`,
              [id, kw, Math.max(1, Math.min(9, i + 1))]
            );
          }
          for (let i = 0; i < phrases.length; i++) {
            const ph = phrases[i];
            await c.query(
              `insert into qa_keywords (qa_id, keyword, weight) values ($1,$2,$3)
               on conflict (qa_id, keyword) do update set weight = excluded.weight`,
              [id, ph, Math.max(2, Math.min(9, i + 2))]
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
    const phrases: Record<string, string[]> = {};
    for (const id of qaIds) {
      const arr = (existingMap.get(id) || []);
      const ws = arr.filter((s) => !/\s/.test(s)).slice(0, max);
      const ps = arr.filter((s) => /\s/.test(s)).slice(0, Math.min(6, max));
      results[id] = ws;
      phrases[id] = ps;
    }
    return NextResponse.json({ results, phrases });
  } catch (e) {
    return NextResponse.json({ results: {} });
  }
}
