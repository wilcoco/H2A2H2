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
});

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
    const maxTokens = detail === "long" ? 2500 : detail === "short" ? 800 : 1500;
    const refineTokens = Math.min(maxTokens + 400, 3000);
    const historyText = (input.history || [])
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");
    const promptText = input.prompt || "";
    // Retrieve top similar Q&As as lightweight context (best-effort)
    let relatedText = "";
    try {
      await ensureTables();
      const q = promptText.trim().toLowerCase();
      if (q) {
        const rows: Array<{ question: string; answer?: string; summary?: string }> = await withConn(async (c) => {
          try {
            const r = await c.query(
              `select question, answer, summary
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
            const trgm = r.rows as Array<{ question: string; answer?: string; summary?: string }>;
            // Keyword-based retrieval
            const kws = kwHeuristic(q, 8);
            let byKw: Array<{ question: string; answer?: string; summary?: string }> = [];
            if (kws.length) {
              const rk = await c.query(
                `select e.question, e.answer, e.summary
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
              byKw = rk.rows as Array<{ question: string; answer?: string; summary?: string }>;
            }
            // Merge and dedup by question text
            const seen = new Set<string>();
            const merged: Array<{ question: string; answer?: string; summary?: string }> = [];
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
              `select question, answer, summary
                 from qa_entries
                where (lower(question) like ('%' || $1 || '%')
                   or lower(coalesce(summary,'')) like ('%' || $1 || '%'))
                  and published = true
                order by created_at desc
                limit 5`,
              [q]
            );
            return r.rows as Array<{ question: string; answer?: string; summary?: string }>;
          }
        });
        const snips = rows.map((r, i) => {
          const a = (r.summary || r.answer || "").toString().slice(0, 400);
          const qx = r.question.toString().slice(0, 200);
          return `${i + 1}) Q: ${qx}\n   A: ${a}`;
        });
        if (snips.length) relatedText = `Relevant prior Q&A (may be partial, for context only):\n${snips.join("\n\n")}`;
      }
    } catch {}

    const combined = `${sys}\n\n${relatedText ? relatedText + "\n\n" : ""}${historyText ? `Conversation:\n${historyText}\n\n` : ""}User: ${promptText}`;
    const anthUser = `${relatedText ? relatedText + "\n\n" : ""}${historyText ? `Conversation:\n${historyText}\n\n` : ""}User: ${promptText}`;

    try {
      let answer = "";
      let providerUsed: "openai" | "anthropic" | "fallback" = provider;
      let modelUsed: string = "";
      let fallbackUsed = false;
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
          if (model.startsWith("o3")) base.reasoning = { effort: "high" };
          try {
            const res = await client.responses.create(base);
            answer = (res as any).output_text?.trim() ?? "";
          } catch {
            if (model !== "gpt-4o") {
              try {
                const res2 = await client.responses.create({ ...base, model: "gpt-4o", reasoning: undefined });
                answer = (res2 as any).output_text?.trim() ?? "";
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
            const refineInput = `${refineInstr}\n\nQuestion: ${promptText}\n\nDraft:\n${answer}\n\n${relatedText ? `Context (may be partial):\n${relatedText}\n` : ""}`;
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
              if (model.startsWith("o3")) refineBody.reasoning = { effort: "high" };
              let improved = "";
              try {
                const r1 = await client.responses.create(refineBody);
                improved = (r1 as any).output_text?.trim() ?? "";
              } catch {
                if (model !== "gpt-4o") {
                  try {
                    const r2 = await client.responses.create({ ...refineBody, model: "gpt-4o", reasoning: undefined });
                    improved = (r2 as any).output_text?.trim() ?? "";
                  } catch {}
                }
              }
              if (improved) answer = improved;
            }
          } catch {}
        }
        return NextResponse.json({ answer, providerUsed, modelUsed, fallbackUsed, detailUsed: detail });
      } else {
        if (client) {
          const base: any = { model, input: combined, temperature: 0.2, max_output_tokens: maxTokens };
          if (model.startsWith("o3")) base.reasoning = { effort: "high" };
          try {
            const res = await client.responses.create(base);
            answer = (res as any).output_text?.trim() ?? "";
          } catch {
            if (model !== "gpt-4o") {
              try {
                const res2 = await client.responses.create({ ...base, model: "gpt-4o", reasoning: undefined });
                answer = (res2 as any).output_text?.trim() ?? "";
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
            const refineInput = `${refineInstr}\n\nQuestion: ${promptText}\n\nDraft:\n${answer}\n\n${relatedText ? `Context (may be partial):\n${relatedText}\n` : ""}`;
            const refineBody: any = { model, input: refineInput, temperature: 0.2, max_output_tokens: refineTokens };
            if (model.startsWith("o3")) refineBody.reasoning = { effort: "high" };
            let improved = "";
            try {
              const r1 = await client.responses.create(refineBody);
              improved = (r1 as any).output_text?.trim() ?? "";
            } catch {
              if (model !== "gpt-4o") {
                try {
                  const r2 = await client.responses.create({ ...refineBody, model: "gpt-4o", reasoning: undefined });
                  improved = (r2 as any).output_text?.trim() ?? "";
                } catch {}
              }
            }
            if (improved) answer = improved;
          } catch {}
        }
        return NextResponse.json({ answer, providerUsed, modelUsed, fallbackUsed, detailUsed: detail });
      }
    } catch {
      return fallback();
    }
  } catch (err) {
    console.error("/api/ai/chat error", err);
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }
}

