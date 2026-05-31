import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { applyAntiMatthewQuota } from "@/lib/nightwish/routing";

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
    const query: string = (body?.query ?? "").toString();
    const limit: number = Math.min(Math.max(Number(body?.limit ?? 5), 1), 10);
    const strict: boolean = !!body?.strict;
    const minScoreRaw = Number(body?.minScore);
    const minScore: number = Number.isFinite(minScoreRaw)
      ? Math.max(0, Math.min(1, minScoreRaw))
      : (strict ? 0.35 : 0.2);
    const q = query.trim();
    const antiMatthew: boolean = body?.antiMatthew !== false; // 기본 활성
    const exploreShare: number = Number.isFinite(Number(body?.exploreShare)) ? Math.max(0, Math.min(0.6, Number(body.exploreShare))) : 0.3;
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
                     ) >= $3
              order by greatest(
                       similarity(lower(question), $1),
                       case when lower(question) like ('%' || $1 || '%') then 0.9 else 0 end,
                       case when lower(coalesce(summary, '')) like ('%' || $1 || '%') then 0.6 else 0 end
                     ) desc,
                       created_at desc
              limit $2`,
            [q.toLowerCase(), limit, minScore]
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
                    ) >= $3
              order by created_at desc
              limit $2`,
            [q.toLowerCase(), limit, minScore]
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
                group by e.id
                order by e.created_at desc
                limit $2`,
              [kws, limit]
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
                  where exists (
                      select 1 from qa_keywords k
                       where k.qa_id = e.id and k.keyword ilike any($1)
                    )
                  group by e.id
                  order by e.created_at desc
                  limit $2`,
                [pats, limit]
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
                  where (
                      question ilike any($1)
                      or coalesce(summary,'') ilike any($1)
                    )
                  order by created_at desc
                  limit $2`,
                [pats, limit]
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
            order by created_at desc limit $1`,
          [limit]
        );
        return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string; created_by?: string }>;
      });
    }
    // Anti-Matthew quota: 신규/잠복/저허브 풀에서 일부 슬롯을 강제 배정.
    // strict 모드(=정확성 우선)일 때는 우회.
    if (antiMatthew && !strict && rows.length > 0) {
      const explore = await withConn(async (c) => {
        // 신규(최근 7일) + 잠복(status='dormant') + 저허브(피드백 0건) 후보를 모음
        const r = await c.query(
          `select e.id, e.question, e.answer, e.summary, e.work_id, e.created_by
             from qa_entries e
             left join (
               select qa_id, count(*) as n from qa_feedback group by qa_id
             ) f on f.qa_id = e.id
            where e.published = true
              and (e.created_at > now() - interval '7 days'
                   or e.status = 'dormant'
                   or coalesce(f.n, 0) = 0)
            order by random()
            limit 40`
        );
        return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; work_id?: string; created_by?: string }>;
      });
      rows = applyAntiMatthewQuota(rows, explore, { limit, exploreShare });
    }
    // organized_pages 우선 매칭 — 같은 쿼리로 정리 페이지 찾고, 결과 앞쪽에 prepend
    type OrganizedHit = { id: string; root_id: string; title: string; summary_line: string; keywords: string[]; organized_by: string };
    let organizedHits: OrganizedHit[] = [];
    if (q) {
      try {
        organizedHits = await withConn(async (c) => {
          try {
            const r = await c.query(
              `select id, root_id, title, summary_line, keywords, organized_by
                 from organized_pages
                where (
                  similarity(lower(title), $1) > 0.2
                  or similarity(lower(summary_line), $1) > 0.2
                  or lower(title) like ('%' || $1 || '%')
                  or lower(summary_line) like ('%' || $1 || '%')
                  or exists (select 1 from unnest(keywords) k where lower(k) like ('%' || $1 || '%'))
                )
                order by greatest(
                         similarity(lower(title), $1),
                         similarity(lower(summary_line), $1),
                         case when lower(title) like ('%' || $1 || '%') then 0.9 else 0 end,
                         case when lower(summary_line) like ('%' || $1 || '%') then 0.7 else 0 end
                       ) desc,
                       view_count desc, updated_at desc
                limit $2`,
              [q.toLowerCase(), limit]
            );
            return r.rows as OrganizedHit[];
          } catch {
            const r = await c.query(
              `select id, root_id, title, summary_line, keywords, organized_by
                 from organized_pages
                where lower(title) like ('%' || $1 || '%')
                   or lower(summary_line) like ('%' || $1 || '%')
                order by updated_at desc
                limit $2`,
              [q.toLowerCase(), limit]
            );
            return r.rows as OrganizedHit[];
          }
        });
      } catch {}
    }

    const organizedItems = organizedHits.map((o) => ({
      id: o.id,
      type: "organized" as const,
      rootId: o.root_id,
      title: o.title,
      question: o.title,                // 검색 화면 호환
      summary: o.summary_line,
      keywords: o.keywords,
      createdBy: o.organized_by,
    }));

    const qaItems = rows.map((r) => ({
      id: r.id,
      type: "qa" as const,
      question: r.question,
      answer: r.answer ?? undefined,
      summary: r.summary ?? undefined,
      workId: r.work_id ?? undefined,
      createdBy: (r as { created_by?: string }).created_by ?? undefined,
    }));

    // organized가 우선 노출되도록 앞쪽 prepend. 중복 root 정밀 제거는 후속 라운드.
    const items = [...organizedItems, ...qaItems].slice(0, limit);
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
            const answerText = (it as { answer?: string }).answer;
            const text = String(it.summary || answerText || it.question || "");
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
