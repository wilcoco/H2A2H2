// LLM wiki 식 RAG: 새 질문이 들어오면 organized_pages 검색 + 1-hop cross-link 확장 →
// 페이지의 title/summary/body 일부를 LLM 컨텍스트로 합성.
// /api/ai/ask가 호출 전에 이 함수로 컨텍스트 빌드.

import { withConn } from "@/lib/db";

export interface RagSource {
  id: string;
  title: string;
  summaryLine: string;
  via: "match" | "link";          // 직접 매칭인지 cross-link 따라온 것인지
  fromPageId?: string;            // via=link일 때, 어디서 따라왔는지
}

export interface RagResult {
  contextText: string;            // LLM에 주입할 텍스트 블록 (비어있을 수 있음)
  sources: RagSource[];
}

const MAX_DIRECT = 3;
const MAX_LINKED = 2;
const SNIPPET = 600;

export async function buildRag(question: string): Promise<RagResult> {
  const q = (question || "").trim().toLowerCase();
  if (!q) return { contextText: "", sources: [] };

  // 1) 직접 매칭 — title/summary/keywords trigram
  const direct = await withConn(async (c) => {
    try {
      const r = await c.query(
        `select id, title, summary_line, body
           from organized_pages
          where (
            similarity(lower(title), $1) > 0.25
            or similarity(lower(summary_line), $1) > 0.25
            or lower(title) like ('%' || $1 || '%')
            or lower(summary_line) like ('%' || $1 || '%')
            or exists (select 1 from unnest(keywords) k where lower(k) like ('%' || $1 || '%'))
          )
          order by greatest(
            similarity(lower(title), $1),
            similarity(lower(summary_line), $1)
          ) desc nulls last, view_count desc, updated_at desc
          limit $2`,
        [q, MAX_DIRECT]
      );
      return r.rows as unknown as Array<{ id: string; title: string; summary_line: string; body: string | null }>;
    } catch {
      const r = await c.query(
        `select id, title, summary_line, body from organized_pages
          where lower(title) like ('%' || $1 || '%') or lower(summary_line) like ('%' || $1 || '%')
          order by updated_at desc limit $2`,
        [q, MAX_DIRECT]
      );
      return r.rows as unknown as Array<{ id: string; title: string; summary_line: string; body: string | null }>;
    }
  });
  if (direct.length === 0) return { contextText: "", sources: [] };

  // 2) cross-link 1-hop 확장
  const directIds = direct.map((d) => d.id);
  const linked = await withConn(async (c) => {
    const r = await c.query(
      `select distinct p.id, p.title, p.summary_line, p.body, l.source_page_id as via_from
         from organized_links l
         join organized_pages p on p.id = l.target_page_id
        where l.source_page_id = any($1) and p.id <> all($1)
        limit $2`,
      [directIds, MAX_LINKED]
    );
    return r.rows as unknown as Array<{ id: string; title: string; summary_line: string; body: string | null; via_from: string }>;
  });

  const sources: RagSource[] = [
    ...direct.map((d) => ({ id: d.id, title: d.title, summaryLine: d.summary_line, via: "match" as const })),
    ...linked.map((l) => ({ id: l.id, title: l.title, summaryLine: l.summary_line, via: "link" as const, fromPageId: l.via_from })),
  ];

  // 3) 컨텍스트 텍스트 합성
  const sections: string[] = [];
  for (const d of direct) {
    const snippet = (d.body || d.summary_line || "").slice(0, SNIPPET);
    sections.push(`[Vault page ${d.id}] ${d.title}\n${snippet}`);
  }
  for (const l of linked) {
    const snippet = (l.body || l.summary_line || "").slice(0, SNIPPET);
    sections.push(`[Vault page ${l.id}] ${l.title} (linked from ${l.via_from})\n${snippet}`);
  }
  const contextText = sections.length > 0
    ? `Relevant prior vault pages (use as facts, cite by [Vault page ID] if you reuse):\n\n${sections.join("\n\n---\n\n")}`
    : "";

  return { contextText, sources };
}
