import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function heuristic(text: string, max = 8): string[] {
  const stop = new Set([
    // English
    "the","a","an","and","or","of","to","in","on","for","with","is","are","was","were","be","as","by","at","from","that","this","it","we","you","they","i","how","what","why","when","where",
    // Korean (basic)
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
  return sorted.slice(0, max);
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = await req.json().catch(() => ({}));
    const token = (req as any).cookies?.get?.("session")?.value ?? undefined;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;
    const query: string = (body?.query ?? "").toString();
    const limit: number = Math.min(Math.max(Number(body?.limit ?? 5), 1), 10);
    const strict: boolean = !!body?.strict;
    const minScoreRaw = Number(body?.minScore);
    const minScore: number = Number.isFinite(minScoreRaw)
      ? Math.max(0, Math.min(1, minScoreRaw))
      : (strict ? 0.35 : 0.2);
    const q = query.trim();
    let rows: Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string; created_by?: string }> = [];
    if (q) {
      try {
        rows = await withConn(async (c) => {
          // Try trigram similarity and simple LIKE matching
          const r = await c.query(
            `select id, question, answer, summary, work_id, published, created_by
               from qa_entries
              where (
                similarity(lower(question), $1) > 0.2
                or lower(question) like ('%' || $1 || '%')
                or lower(coalesce(summary, '')) like ('%' || $1 || '%')
              )
              and greatest(
                       similarity(lower(question), $1),
                       case when lower(question) like ('%' || $1 || '%') then 0.9 else 0 end,
                       case when lower(coalesce(summary, '')) like ('%' || $1 || '%') then 0.6 else 0 end
                     ) >= $4
              and (published = true or created_by = $3)
              order by greatest(
                       similarity(lower(question), $1),
                       case when lower(question) like ('%' || $1 || '%') then 0.9 else 0 end,
                       case when lower(coalesce(summary, '')) like ('%' || $1 || '%') then 0.6 else 0 end
                     ) desc,
                       created_at desc
              limit $2`,
            [q.toLowerCase(), limit, userId, minScore]
          );
          return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string; created_by?: string }>;
        });
      } catch {
        // Fallback to LIKE-only if pg_trgm/similarity is unavailable
        rows = await withConn(async (c) => {
          const r = await c.query(
            `select id, question, answer, summary, work_id, published, created_by
               from qa_entries
              where (lower(question) like ('%' || $1 || '%')
                 or lower(coalesce(summary,'')) like ('%' || $1 || '%'))
                and greatest(
                      case when lower(question) like ('%' || $1 || '%') then 0.9 else 0 end,
                      case when lower(coalesce(summary, '')) like ('%' || $1 || '%') then 0.6 else 0 end
                    ) >= $4
                and (published = true or created_by = $3)
              order by created_at desc
              limit $2`,
            [q.toLowerCase(), limit, userId, minScore]
          );
          return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string }>; 
        });
      }

      // If no results (common with very long queries), fall back to keyword index matching
      if (!rows.length && !strict) {
        const kws = heuristic(q, 8);
        if (kws.length) {
          // ANY keyword match via qa_keywords
          let kwRows = await withConn(async (c) => {
            const r = await c.query(
              `select e.id, e.question, e.answer, e.summary, e.work_id, e.created_by
                 from qa_entries e
                 join qa_keywords k on k.qa_id = e.id
                where k.keyword = any($1)
                  and (e.published = true or e.created_by = $3)
                group by e.id
                order by e.created_at desc
                limit $2`,
              [kws, limit, userId]
            );
            return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string; created_by?: string }>;
          });
          // Partial match on keywords if exact keyword hits are empty
          if (!kwRows.length) {
            const pats = kws.map((k) => `%${k}%`);
            kwRows = await withConn(async (c) => {
              const r = await c.query(
                `select e.id, e.question, e.answer, e.summary, e.work_id, e.created_by
                   from qa_entries e
                  where (e.published = true or e.created_by = $3)
                    and exists (
                      select 1 from qa_keywords k
                       where k.qa_id = e.id and k.keyword ilike any($1)
                    )
                  group by e.id
                  order by e.created_at desc
                  limit $2`,
                [pats, limit, userId]
              );
              return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string; created_by?: string }>;
            });
          }
          // As last resort, partial match tokens in question/summary
          if (!kwRows.length) {
            const pats = kws.map((k) => `%${k}%`);
            kwRows = await withConn(async (c) => {
              const r = await c.query(
                `select id, question, answer, summary, work_id, created_by
                   from qa_entries
                  where (published = true or created_by = $3)
                    and (
                      question ilike any($1)
                      or coalesce(summary,'') ilike any($1)
                    )
                  order by created_at desc
                  limit $2`,
                [pats, limit, userId]
              );
              return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string; created_by?: string }>;
            });
          }
          rows = kwRows;
        }
      }
    }
    // Fallback to recent if no matches
    if ((!rows || rows.length === 0) && !strict) {
      rows = await withConn(async (c) => {
        const r = await c.query(
          `select id, question, answer, summary, work_id, created_by from qa_entries
            where published = true or created_by = $2
            order by created_at desc limit $1`,
          [limit, userId]
        );
        return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string; created_by?: string }>;
      });
    }
    const items = rows.map((r) => ({
      id: r.id,
      question: r.question,
      answer: r.answer ?? undefined,
      summary: r.summary ?? undefined,
      workId: r.work_id ?? undefined,
      createdBy: (r as any).created_by ?? undefined,
    }));
    // Keyword caching on first search
    const ids = items.map((i) => i.id);
    let keywords: Record<string, string[]> = {};
    if (ids.length > 0) {
      const existing = await withConn(async (c) => {
        const r = await c.query(`select qa_id, keyword from qa_keywords where qa_id = any($1)`, [ids]);
        return r.rows as Array<{ qa_id: string; keyword: string }>;
      });
      const have = new Map<string, string[]>();
      for (const { qa_id, keyword } of existing) {
        if (!have.has(qa_id)) have.set(qa_id, []);
        have.get(qa_id)!.push(keyword);
      }
      const need = ids.filter((id) => !(have.get(id)?.length));
      if (need.length) {
        // Build texts from items
        const byId = new Map(items.map((it) => [it.id, it] as const));
        await withConn(async (c) => {
          for (const id of need) {
            const it = byId.get(id);
            if (!it) continue;
            const text = String(it.summary || it.answer || it.question || "");
            const kws = heuristic(text, 8);
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
      }
      // Load all keywords for response (optional)
      const loaded = await withConn(async (c) => {
        const r = await c.query(`select qa_id, keyword from qa_keywords where qa_id = any($1)`, [ids]);
        return r.rows as Array<{ qa_id: string; keyword: string }>;
      });
      const out = new Map<string, string[]>();
      for (const { qa_id, keyword } of loaded) {
        if (!out.has(qa_id)) out.set(qa_id, []);
        out.get(qa_id)!.push(keyword);
      }
      keywords = Object.fromEntries(ids.map((id) => [id, (out.get(id) || []).slice(0, 8)]));
    }
    return NextResponse.json({ items, keywords });
  } catch (e) {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
