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

    const fallback = () => {
      const answer = input.prompt
        ? `임시 응답: ${input.prompt}`
        : "임시 응답: 질문 내용을 입력하세요.";
      return NextResponse.json({ answer });
    };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return fallback();

    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-4o";

    const sys = "You are a helpful assistant. Answer in the user's language. Output structure: (1) A 1-2 sentence answer first. (2) 2-3 key reasons or evidence. (3) Uncertainty/limits if any. (4) If needed, one clarifying question at the end.";
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

    try {
      const base: any = { model, input: combined, temperature: 0.2, max_output_tokens: 1200 };
      if (model.startsWith("o3")) base.reasoning = { effort: "high" };
      let answer = "";
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
      if (!answer) return fallback();
      // Optional second pass refine
      const doRefine = process.env.CHAT_REFINE_PASS !== "0";
      if (doRefine) {
        try {
          const refineInstr = "Review and improve the draft for accuracy, completeness, clarity, and structure. Keep the same language as the user. Do not invent sources. If uncertain, state limits.";
          const refineInput = `${refineInstr}\n\nQuestion: ${promptText}\n\nDraft:\n${answer}\n\n${relatedText ? `Context (may be partial):\n${relatedText}\n` : ""}`;
          const refineBody: any = { model, input: refineInput, temperature: 0.2, max_output_tokens: 1500 };
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
      return NextResponse.json({ answer });
    } catch {
      return fallback();
    }
  } catch (err) {
    console.error("/api/ai/chat error", err);
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }
}

