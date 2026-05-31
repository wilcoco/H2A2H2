// 대화 가지(root_id) 전체를 LLM이 한 번에 보고 "정리 페이지" 초안 생성.
// router.routeAndCall로 호출 → quota 자동 적용.

import { z } from "zod";
import { withConn } from "@/lib/db";
import { routeAndCall, type RouteResult } from "./router";

export const OrganizedSchema = z.object({
  title: z.string().min(1).max(160),
  summary_line: z.string().min(1).max(220),
  body: z.string().min(1).max(8000),
  keywords: z.array(z.string().min(1).max(30)).max(15),
  category: z.string().max(40).optional().default(""),
  verification_candidates: z.array(z.object({
    metric: z.string().min(1).max(60),
    direction: z.enum(["higher_better", "lower_better"]).optional(),
    rationale: z.string().max(200).optional(),
  })).max(5).optional().default([]),
});

export type Organized = z.infer<typeof OrganizedSchema>;

const SYSTEM = `You compress a multi-step Q&A conversation (a "branch") into ONE searchable page.

Goal: future users searching the same problem should LAND on your page first and
quickly understand the answer without reading the whole conversation.

Return ONLY valid JSON with keys:
  title (한국어 가능, 50자 내외, 검색에서 클릭하고 싶은 형태)
  summary_line (1줄, 100자 이내, 답의 핵심 명제)
  body (마크다운, 본문. 3~7문단. 한국어 답이면 한국어로)
  keywords (검색 키워드 5~10개; 한/영 혼용 가능; 매우 구체적인 명사 위주)
  category (선택; 분야 1개 — 예: "사출/생산", "프로그래밍", "건강/의료", "법무")
  verification_candidates (이 답이 효과 있었는지 외부로 측정할 수 있는 지표 후보, 최대 3개;
    각각 {metric, direction: higher_better|lower_better, rationale})

WIKI CROSS-LINKING:
You may be given "EXISTING PAGES" — other organized pages in the same vault.
If your body discusses a concept that an existing page already covers in depth,
INSERT a wikilink in the body using the form: [[org_xxxxxxxxx|surface text]]
where org_xxxxxxxxx is the EXACT page id from the EXISTING PAGES list and
"surface text" is the natural Korean/English phrase as it appears in your body.

Rules:
- Only link to pages whose title/summary clearly matches what you discuss.
- Do NOT invent ids. If unsure, omit the link.
- Maximum 5 wikilinks per body.
- Wikilinks must be inline in the body (not in a separate "관련" section).

Do NOT include analysis like "이 답을 작성한 이유" or "추가 확인 질문".
Body는 정리 본문 자체만.`;

export async function organizeBranch(
  email: string | null,
  rootId: string,
  opts: { preferByok?: boolean } = {}
): Promise<{ draft: Organized; meta: Pick<RouteResult, "tier" | "modelUsed" | "providerUsed" | "quotaAfter"> }> {
  const branch = await withConn(async (c) => {
    const r = await c.query(
      `select id, question, answer, summary, created_by, created_at, forked_from
         from qa_entries
        where coalesce(root_id, id) = $1 and published = true
        order by created_at asc
        limit 50`,
      [rootId]
    );
    return r.rows as unknown as Array<{ id: string; question: string; answer: string | null; summary: string | null; created_by: string | null; created_at: string; forked_from: string | null }>;
  });

  if (branch.length === 0) throw new Error("empty_branch");

  // W1: cross-link 후보 — 같은 vault(베타에서는 전체)의 기존 organized_pages 중
  // 가지 키워드와 겹치는 것 상위 8개를 LLM에게 제공.
  const branchText = branch.map((n) => `${n.question} ${n.summary || n.answer || ""}`).join(" ").toLowerCase();
  const candidates = await withConn(async (c) => {
    try {
      const r = await c.query(
        `select id, title, summary_line from organized_pages
           where root_id <> $1
           order by greatest(
             similarity(lower(title), $2),
             similarity(lower(summary_line), $2)
           ) desc nulls last,
           view_count desc, updated_at desc
           limit 8`,
        [rootId, branchText.slice(0, 800)]
      );
      return r.rows as unknown as Array<{ id: string; title: string; summary_line: string }>;
    } catch {
      // pg_trgm 없으면 최근 페이지 8개로 폴백
      const r = await c.query(
        `select id, title, summary_line from organized_pages where root_id <> $1 order by updated_at desc limit 8`,
        [rootId]
      );
      return r.rows as unknown as Array<{ id: string; title: string; summary_line: string }>;
    }
  });

  const candidatesText = candidates.length > 0
    ? `\n\nEXISTING PAGES (use as wikilink targets if relevant):\n` +
      candidates.map((p) => `- ${p.id}: "${p.title}" — ${p.summary_line}`).join("\n")
    : "";

  const userText = `Branch root: ${rootId} (${branch.length} nodes)\n\n` +
    branch.map((n, i) => `### Node ${i + 1} (${n.id}${n.forked_from ? `, fork of ${n.forked_from}` : ""})\nQ: ${n.question}\nA: ${(n.summary || n.answer || "").slice(0, 1800)}`).join("\n\n") +
    candidatesText;

  const result = await routeAndCall(
    email,
    { system: SYSTEM, user: userText, maxTokens: 2400, temperature: 0.2 },
    { preferByok: opts.preferByok }
  );

  // JSON 추출 + 검증. 모델이 코드펜스를 둘러줄 수 있음.
  const cleaned = result.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); } catch {
    // 첫 { 부터 마지막 } 까지만 시도
    const a = cleaned.indexOf("{");
    const b = cleaned.lastIndexOf("}");
    if (a >= 0 && b > a) parsed = JSON.parse(cleaned.slice(a, b + 1));
    else throw new Error("organize_json_parse_failed");
  }
  const draft = OrganizedSchema.parse(parsed);
  draft.body = draft.body.trim();
  draft.keywords = Array.from(new Set(draft.keywords.map((k) => k.trim()).filter(Boolean)));

  return {
    draft,
    meta: {
      tier: result.tier,
      modelUsed: result.modelUsed,
      providerUsed: result.providerUsed,
      quotaAfter: result.quotaAfter,
    },
  };
}
