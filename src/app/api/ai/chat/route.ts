import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ChatMsg = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const Body = z.object({
  prompt: z.string().optional().default(""),
  history: z.array(ChatMsg).optional().default([]),
  provider: z.enum(["openai", "anthropic"]).optional(),
  detail: z.enum(["short", "normal", "long"]).optional(),
  previousResponseId: z.string().optional(),
  contextIds: z.array(z.string()).optional().default([]),
  suggestRelation: z.boolean().optional().default(false),
  relationA: z
    .object({
      question: z.string().optional().default(""),
      answerOrSummary: z.string().optional().default(""),
    })
    .optional(),
  relationB: z
    .object({
      question: z.string().optional().default(""),
      answerOrSummary: z.string().optional().default(""),
    })
    .optional(),
});

const REL_TYPES = [
  "narrows",
  "elaborates",
  "clarifies",
  "prerequisite",
  "precedes",
  "supports",
  "refutes",
  "alternative",
] as const;

const RelSuggestSchema = z.object({
  type: z.enum(REL_TYPES),
  direction: z.enum(["a_to_b", "b_to_a"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(280),
});

type RelSuggestion = z.infer<typeof RelSuggestSchema>;

function clip(s: string, max: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

type OpenAIResponsesCreateParams = Parameters<InstanceType<typeof OpenAI>["responses"]["create"]>[0];

function openAiOutputText(res: unknown): string {
  const v = (res as { output_text?: unknown } | null | undefined)?.output_text;
  return typeof v === "string" ? v.trim() : "";
}

async function suggestRelationWithAi(opts: {
  provider: "openai" | "anthropic";
  openaiKey?: string;
  anthropicKey?: string;
  model: string;
  anthropicModel: string;
  aQ: string;
  aA: string;
  bQ: string;
  bA: string;
}): Promise<{ suggestion: RelSuggestion; providerUsed: "openai" | "anthropic"; modelUsed: string } | null> {
  const aQ = clip(opts.aQ, 240);
  const bQ = clip(opts.bQ, 240);
  const aA = clip(opts.aA, 520);
  const bA = clip(opts.bA, 520);

  const system = `You classify the relationship between two Q&A entries A and B.
Pick exactly one relation type from: ${REL_TYPES.join(", ")}.
Return direction as:
- a_to_b if the relation should be stored as A -> B
- b_to_a if the relation should be stored as B -> A
Direction semantics (stored edge source -> target):
- precedes: source happens before / should be learned before target
- prerequisite: source is a prerequisite for target
- supports: source supports target (evidence -> claim)
- refutes: source refutes/contradicts target
- clarifies: source clarifies target (definition/summary/disambiguation -> clarified)
- elaborates: target is a more detailed elaboration of source
- narrows: target is a narrower/specific subset of source
- alternative: target is an alternative/compare item to source (use low confidence if unsure)
If unsure, choose alternative or precedes with confidence <= 0.55.
Return ONLY valid JSON with keys: type, direction, confidence, rationale. rationale must be in Korean.`;

  const userText = `A.question=${aQ}
A.answer_or_summary=${aA || "(none)"}

B.question=${bQ}
B.answer_or_summary=${bA || "(none)"}`;

  const runOpenAI = async (): Promise<{ suggestion: RelSuggestion; modelUsed: string } | null> => {
    if (!opts.openaiKey) return null;
    const client = new OpenAI({ apiKey: opts.openaiKey });
    const body: Record<string, unknown> = {
      model: opts.model,
      input: `${system}\n\n${userText}`,
      temperature: 0.1,
      max_output_tokens: 400,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "RelationSuggestion",
          strict: true,
          schema: {
            type: "object",
            properties: {
              type: { type: "string", enum: REL_TYPES as unknown as string[] },
              direction: { type: "string", enum: ["a_to_b", "b_to_a"] },
              confidence: { type: "number" },
              rationale: { type: "string" },
            },
            required: ["type", "direction", "confidence", "rationale"],
            additionalProperties: false,
          },
        },
      },
    };
    try {
      const rr = await client.responses.create(body as unknown as OpenAIResponsesCreateParams);
      const text = openAiOutputText(rr);
      if (!text) return null;
      const parsed = JSON.parse(text);
      const suggestion = RelSuggestSchema.parse(parsed);
      return { suggestion, modelUsed: opts.model };
    } catch {
      if (opts.model !== "gpt-4o") {
        try {
          const rr = await client.responses.create({ ...body, model: "gpt-4o" } as unknown as OpenAIResponsesCreateParams);
          const text = openAiOutputText(rr);
          if (!text) return null;
          const parsed = JSON.parse(text);
          const suggestion = RelSuggestSchema.parse(parsed);
          return { suggestion, modelUsed: "gpt-4o" };
        } catch {
          return null;
        }
      }
      return null;
    }
  };

  const runAnthropic = async (): Promise<{ suggestion: RelSuggestion; modelUsed: string } | null> => {
    if (!opts.anthropicKey) return null;
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": opts.anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: opts.anthropicModel,
          system: "Return ONLY valid JSON.",
          max_tokens: 700,
          temperature: 0.1,
          messages: [{ role: "user", content: [{ type: "text", text: `${system}\n\n${userText}` }] }],
        }),
      });
      const j: unknown = await resp.json().catch(() => ({}));
      const content = (j && typeof j === "object" && "content" in j) ? (j as { content?: unknown }).content : undefined;
      const parts: unknown[] = Array.isArray(content) ? content : [];
      const text = parts
        .map((p) => {
          if (!p || typeof p !== "object") return "";
          const ty = (p as { type?: unknown }).type;
          if (ty !== "text") return "";
          const tx = (p as { text?: unknown }).text;
          return typeof tx === "string" ? tx : "";
        })
        .filter((s) => !!s)
        .join("\n")
        .trim();
      if (!text) return null;
      const parsed = JSON.parse(text);
      const suggestion = RelSuggestSchema.parse(parsed);
      return { suggestion, modelUsed: opts.anthropicModel };
    } catch {
      return null;
    }
  };

  if (opts.provider === "anthropic") {
    const a = await runAnthropic();
    if (a) return { ...a, providerUsed: "anthropic" };
    const o = await runOpenAI();
    if (o) return { ...o, providerUsed: "openai" };
    return null;
  }

  const o = await runOpenAI();
  if (o) return { ...o, providerUsed: "openai" };
  const a = await runAnthropic();
  if (a) return { ...a, providerUsed: "anthropic" };
  return null;
}

function kwHeuristic(text: string, max = 8): string[] {
  const stop = new Set([
    "the","a","an","and","or","of","to","in","on","for","with","is","are","was","were","be","as","by","at","from","that","this","it","we","you","they","i","how","what","why","when","where",
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

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const input = Body.parse(json);
    const explicitProvider = Boolean((json as any)?.provider);
    const detail = (input.detail ?? (process.env.ANSWER_LENGTH as any) ?? "normal") as "short" | "normal" | "long";

    const fallback = () => {
      const answer = input.prompt
        ? `임시 응답: ${input.prompt}`
        : "임시 응답: 질문 내용을 입력하세요.";
      return NextResponse.json({ answer });
    };

    const provider = input.provider ?? (process.env.AI_PROVIDER as any) ?? "openai";
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const client = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
    const model = process.env.OPENAI_MODEL || "gpt-4o";
    const anthropicModel = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

    const styleLine =
      detail === "short"
        ? "Be concise. Aim for 3–5 sentences."
        : detail === "long"
        ? "Be thorough and well-structured with clear paragraphs and bullet points as needed."
        : "Be balanced and complete without unnecessary brevity.";
    const sys = `You are a helpful assistant. Answer in the user's language. Provide ONLY the final answer. Do not include analysis or review sections. Do not use headings like '검토 결과', '개선점', '불확실성', or '추가 확인 질문'. Do not enumerate sections (no (1)(2)(3)). Include a brief caveat only if strictly necessary for correctness. ${styleLine}`;
    const reasoningEffort = detail === "short" ? "low" : detail === "long" ? "high" : "medium";
    const isReasoningModel = /^o\d/i.test(model);
    const maxTokens = detail === "long" ? 2500 : detail === "short" ? 800 : 1500;
    const refineTokens = Math.min(maxTokens + 400, 3000);
    const historyText = (input.history || [])
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");
    const promptText = input.prompt || "";
    // Retrieve selected Q&As and top similar Q&As as lightweight context (best-effort)
    let relatedText = "";
    let selectedText = "";
    let anchorPrevId: string | undefined;
    try {
      await ensureTables();
      const q = promptText.trim().toLowerCase();
      // Selected context by explicit IDs
      try {
        const ids = Array.isArray((input as any)?.contextIds) ? (input as any).contextIds.filter((x: any) => typeof x === "string") as string[] : [];
        if (ids.length) {
          const rows = await withConn(async (c) => {
            const r = await c.query(
              `select id, question, answer, summary, last_response_id from qa_entries where id = any($1) and published = true limit 8`,
              [ids]
            );
            return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; last_response_id?: string | null }>;
          });
          const items = rows.slice(0, 5).map((r, i) => {
            const a = (r.summary || r.answer || "").toString().slice(0, 400);
            const qx = r.question.toString().slice(0, 200);
            return `${i + 1}) Q: ${qx}\n   A: ${a}`;
          });
          if (items.length) selectedText = `Selected context (user-picked):\n${items.join("\n\n")}`;
          // Prefer anchor from selected context when available
          if (!input.previousResponseId && !anchorPrevId) {
            const acand = rows.find((r) => (r.last_response_id || "").toString().trim());
            if (acand?.last_response_id) anchorPrevId = String(acand.last_response_id);
          }
        }
      } catch {}
      if (q) {
        const rows: Array<{ id: string; question: string; answer?: string; summary?: string; last_response_id?: string | null }> = await withConn(async (c) => {
          try {
            const r = await c.query(
              `select id, question, answer, summary, last_response_id
                 from qa_entries
                where (
                  similarity(lower(question), $1) > 0.2
                  or lower(question) like ('%' || $1 || '%')
                  or lower(coalesce(summary, '')) like ('%' || $1 || '%')
                ) and published = true
                order by greatest(
                         similarity(lower(question), $1),
                         case when lower(question) like ('%' || $1 || '%') then 0.9 else 0 end,
                         case when lower(coalesce(summary, '')) like ('%' || $1 || '%') then 0.6 else 0 end
                       ) desc,
                       created_at desc
                limit 5`,
              [q]
            );
            const trgm = r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; last_response_id?: string | null }>;
            // Keyword-based retrieval
            const kws = kwHeuristic(q, 8);
            let byKw: Array<{ id: string; question: string; answer?: string; summary?: string; last_response_id?: string | null }> = [];
            if (kws.length) {
              const rk = await c.query(
                `select e.id, e.question, e.answer, e.summary, e.last_response_id
                   from qa_entries e
                  join (
                    select qa_id, sum(weight) as score
                      from qa_keywords
                     where keyword = any($2)
                     group by qa_id
                  ) k on k.qa_id = e.id
                 where e.published = true
                 order by k.score desc, e.created_at desc
                 limit 5`,
                [q, kws]
              );
              byKw = rk.rows as Array<{ id: string; question: string; answer?: string; summary?: string; last_response_id?: string | null }>;
            }
            // Merge and dedup by question text
            const seen = new Set<string>();
            const merged: Array<{ id: string; question: string; answer?: string; summary?: string; last_response_id?: string | null }> = [];
            for (const item of [...byKw, ...trgm]) {
              const key = (item.question || "").toLowerCase().slice(0, 300);
              if (key && !seen.has(key)) {
                seen.add(key);
                merged.push(item);
              }
            }
            return merged.slice(0, 5);
          } catch {
            const r = await c.query(
              `select id, question, answer, summary, last_response_id
                 from qa_entries
                where (lower(question) like ('%' || $1 || '%')
                   or lower(coalesce(summary,'')) like ('%' || $1 || '%'))
                  and published = true
                order by created_at desc
                limit 5`,
              [q]
            );
            return r.rows as Array<{ id: string; question: string; answer?: string; summary?: string; last_response_id?: string | null }>;
          }
        });
        const snips = rows.map((r, i) => {
          const a = (r.summary || r.answer || "").toString().slice(0, 400);
          const qx = r.question.toString().slice(0, 200);
          return `${i + 1}) Q: ${qx}\n   A: ${a}`;
        });
        if (snips.length) relatedText = `Relevant prior Q&A (may be partial, for context only):\n${snips.join("\n\n")}`;
        // pick an anchor previous_response_id if not provided
        const cand = rows.find((r) => (r.last_response_id || "").toString().trim());
        if (!anchorPrevId && cand?.last_response_id) anchorPrevId = String(cand.last_response_id);
      }
    } catch {}

    const combined = `${sys}\n\n${selectedText ? selectedText + "\n\n" : ""}${relatedText ? relatedText + "\n\n" : ""}${historyText ? `Conversation:\n${historyText}\n\n` : ""}User: ${promptText}`;
    const anthUser = `${selectedText ? selectedText + "\n\n" : ""}${relatedText ? relatedText + "\n\n" : ""}${historyText ? `Conversation:\n${historyText}\n\n` : ""}User: ${promptText}`;

    try {
      let answer = "";
      let providerUsed: "openai" | "anthropic" | "fallback" = provider;
      let modelUsed: string = "";
      let fallbackUsed = false;
      let responseId: string | undefined;
      let relationSuggestion:
        | {
            type: (typeof REL_TYPES)[number];
            relDir: "current_to_new" | "new_to_current";
            confidence: number;
            rationale: string;
            providerUsed: "openai" | "anthropic";
            modelUsed: string;
          }
        | undefined;
      if (provider === "anthropic") {
        const antKey = process.env.ANTHROPIC_API_KEY;
        if (antKey) {
          try {
            const resp = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-api-key": antKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: anthropicModel,
                system: sys,
                max_tokens: maxTokens,
                temperature: 0.2,
                messages: [
                  { role: "user", content: [{ type: "text", text: anthUser }] },
                ],
              }),
            });
            const j = await resp.json().catch(() => ({} as any));
            const parts: Array<{ type: string; text?: string }> = Array.isArray(j?.content) ? j.content : [];
            answer = parts.filter((p) => p?.type === "text").map((p) => String(p.text || "")).join("\n").trim();
          } catch {}
        }
        if (!answer && client && !explicitProvider) {
          const base: any = { model, input: combined, temperature: 0.2, max_output_tokens: maxTokens };
          if (isReasoningModel) base.reasoning = { effort: reasoningEffort };
          try {
            if (input.previousResponseId) base.previous_response_id = input.previousResponseId;
            else if (anchorPrevId) base.previous_response_id = anchorPrevId;
            const res = await client.responses.create(base);
            answer = (res as any).output_text?.trim() ?? "";
            responseId = (res as any)?.id;
          } catch {
            if (model !== "gpt-4o") {
              try {
                const res2 = await client.responses.create({ ...base, model: "gpt-4o", reasoning: undefined });
                answer = (res2 as any).output_text?.trim() ?? "";
                responseId = (res2 as any)?.id;
              } catch {}
            }
          }
          if (answer) { providerUsed = "openai"; modelUsed = model; fallbackUsed = true; }
        }
        if (!answer) return NextResponse.json({ answer: "", error: "anthropic_failed", providerExpected: provider, modelExpected: anthropicModel });
        providerUsed = "anthropic"; modelUsed = anthropicModel;
        const doRefine = process.env.CHAT_REFINE_PASS !== "0";
        if (doRefine) {
          try {
            const refineInstr = `Rewrite into a final, direct answer only. Remove any meta-analysis, review-style sections, or numbered structure. Keep the user's language and tone. Do not add follow-up questions. ${detail === "short" ? "Keep it concise (3–5 sentences)." : detail === "long" ? "Make it thorough and well-structured." : "Balance brevity and completeness."}`;
            const refineInput = `${refineInstr}\n\nQuestion: ${promptText}\n\nDraft:\n${answer}\n\n${selectedText ? `Selected context (user-picked):\n${selectedText}\n\n` : ""}${relatedText ? `Context (may be partial):\n${relatedText}\n` : ""}`;
            if (antKey) {
              try {
                const resp2 = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-api-key": antKey,
                    "anthropic-version": "2023-06-01",
                  },
                  body: JSON.stringify({
                    model: anthropicModel,
                    system: sys,
                    max_tokens: refineTokens,
                    temperature: 0.2,
                    messages: [
                      { role: "user", content: [{ type: "text", text: refineInput }] },
                    ],
                  }),
                });
                const jj = await resp2.json().catch(() => ({} as any));
                const parts2: Array<{ type: string; text?: string }> = Array.isArray(jj?.content) ? jj.content : [];
                const improved = parts2.filter((p) => p?.type === "text").map((p) => String(p.text || "")).join("\n").trim();
                if (improved) answer = improved;
              } catch {}
            } else if (client) {
              const refineBody: any = { model, input: refineInput, temperature: 0.2, max_output_tokens: refineTokens };
              if (isReasoningModel) refineBody.reasoning = { effort: reasoningEffort };
              if (responseId) refineBody.previous_response_id = responseId;
              let improved = "";
              try {
                const r1 = await client.responses.create(refineBody);
                improved = (r1 as any).output_text?.trim() ?? "";
                responseId = (r1 as any)?.id ?? responseId;
              } catch {
                if (model !== "gpt-4o") {
                  try {
                    const r2 = await client.responses.create({ ...refineBody, model: "gpt-4o", reasoning: undefined });
                    improved = (r2 as any).output_text?.trim() ?? "";
                    responseId = (r2 as any)?.id ?? responseId;
                  } catch {}
                }
              }
              if (improved) answer = improved;
            }
          } catch {}
        }
        if (input.suggestRelation) {
          const aQ = String(input.relationA?.question || (input.history?.[0]?.role === "user" ? input.history?.[0]?.content : "") || "");
          const aA = String(input.relationA?.answerOrSummary || "");
          const bQ = String(input.relationB?.question || input.prompt || "");
          const bA = String(input.relationB?.answerOrSummary || "");
          const rel = await suggestRelationWithAi({
            provider,
            openaiKey: process.env.OPENAI_API_KEY,
            anthropicKey: process.env.ANTHROPIC_API_KEY,
            model,
            anthropicModel,
            aQ,
            aA,
            bQ,
            bA,
          });
          if (rel?.suggestion) {
            relationSuggestion = {
              type: rel.suggestion.type,
              relDir: rel.suggestion.direction === "a_to_b" ? "current_to_new" : "new_to_current",
              confidence: rel.suggestion.confidence,
              rationale: rel.suggestion.rationale,
              providerUsed: rel.providerUsed,
              modelUsed: rel.modelUsed,
            };
          }
        }
        return NextResponse.json({ answer, providerUsed, modelUsed, fallbackUsed, detailUsed: detail, responseId, maxTokensUsed: maxTokens, reasoningEffortUsed: isReasoningModel ? reasoningEffort : undefined, relationSuggestion });
      } else {
        if (client) {
          const base: any = { model, input: combined, temperature: 0.2, max_output_tokens: maxTokens };
          if (isReasoningModel) base.reasoning = { effort: reasoningEffort };
          try {
            if (input.previousResponseId) base.previous_response_id = input.previousResponseId;
            else if (anchorPrevId) base.previous_response_id = anchorPrevId;
            const res = await client.responses.create(base);
            answer = (res as any).output_text?.trim() ?? "";
            responseId = (res as any)?.id;
          } catch {
            if (model !== "gpt-4o") {
              try {
                const res2 = await client.responses.create({ ...base, model: "gpt-4o", reasoning: undefined });
                answer = (res2 as any).output_text?.trim() ?? "";
                responseId = (res2 as any)?.id;
              } catch {}
            }
          }
          if (answer) { providerUsed = "openai"; modelUsed = model; }
        } else if (anthropicKey && !explicitProvider) {
          try {
            const resp = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: anthropicModel,
                system: sys,
                max_tokens: maxTokens,
                temperature: 0.2,
                messages: [
                  { role: "user", content: [{ type: "text", text: anthUser }] },
                ],
              }),
            });
            const j = await resp.json().catch(() => ({} as any));
            const parts: Array<{ type: string; text?: string }> = Array.isArray(j?.content) ? j.content : [];
            answer = parts.filter((p) => p?.type === "text").map((p) => String(p.text || "")).join("\n").trim();
          } catch {}
          if (answer) { providerUsed = "anthropic"; modelUsed = anthropicModel; fallbackUsed = true; }
        }
        if (!answer) return NextResponse.json({ answer: "", error: "openai_failed", providerExpected: provider, modelExpected: model });
        const doRefine = process.env.CHAT_REFINE_PASS !== "0";
        if (doRefine && client) {
          try {
            const refineInstr = `Rewrite into a final, direct answer only. Remove any meta-analysis, review-style sections, or numbered structure. Keep the user's language and tone. Do not add follow-up questions. ${detail === "short" ? "Keep it concise (3–5 sentences)." : detail === "long" ? "Make it thorough and well-structured." : "Balance brevity and completeness."}`;
            const refineInput = `${refineInstr}\n\nQuestion: ${promptText}\n\nDraft:\n${answer}\n\n${selectedText ? `Selected context (user-picked):\n${selectedText}\n\n` : ""}${relatedText ? `Context (may be partial):\n${relatedText}\n` : ""}`;
            const refineBody: any = { model, input: refineInput, temperature: 0.2, max_output_tokens: refineTokens };
            if (isReasoningModel) refineBody.reasoning = { effort: reasoningEffort };
            if (responseId) refineBody.previous_response_id = responseId;
            let improved = "";
            try {
              const r1 = await client.responses.create(refineBody);
              improved = (r1 as any).output_text?.trim() ?? "";
              responseId = (r1 as any)?.id ?? responseId;
            } catch {
              if (model !== "gpt-4o") {
                try {
                  const r2 = await client.responses.create({ ...refineBody, model: "gpt-4o", reasoning: undefined });
                  improved = (r2 as any).output_text?.trim() ?? "";
                  responseId = (r2 as any)?.id ?? responseId;
                } catch {}
              }
            }
            if (improved) answer = improved;
          } catch {}
        }
        if (input.suggestRelation) {
          const aQ = String(input.relationA?.question || (input.history?.[0]?.role === "user" ? input.history?.[0]?.content : "") || "");
          const aA = String(input.relationA?.answerOrSummary || "");
          const bQ = String(input.relationB?.question || input.prompt || "");
          const bA = String(input.relationB?.answerOrSummary || "");
          const rel = await suggestRelationWithAi({
            provider,
            openaiKey: process.env.OPENAI_API_KEY,
            anthropicKey: process.env.ANTHROPIC_API_KEY,
            model,
            anthropicModel,
            aQ,
            aA,
            bQ,
            bA,
          });
          if (rel?.suggestion) {
            relationSuggestion = {
              type: rel.suggestion.type,
              relDir: rel.suggestion.direction === "a_to_b" ? "current_to_new" : "new_to_current",
              confidence: rel.suggestion.confidence,
              rationale: rel.suggestion.rationale,
              providerUsed: rel.providerUsed,
              modelUsed: rel.modelUsed,
            };
          }
        }
        return NextResponse.json({ answer, providerUsed, modelUsed, fallbackUsed, detailUsed: detail, responseId, maxTokensUsed: maxTokens, reasoningEffortUsed: isReasoningModel ? reasoningEffort : undefined, relationSuggestion });
      }
    } catch {
      return fallback();
    }
  } catch (err) {
    console.error("/api/ai/chat error", err);
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }
}

