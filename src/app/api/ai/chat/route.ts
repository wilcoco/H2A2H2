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
                limit 3`,
              [q]
            );
            return r.rows as Array<{ question: string; answer?: string; summary?: string }>;
          } catch {
            const r = await c.query(
              `select question, answer, summary
                 from qa_entries
                where (lower(question) like ('%' || $1 || '%')
                   or lower(coalesce(summary,'')) like ('%' || $1 || '%'))
                  and published = true
                order by created_at desc
                limit 3`,
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
      const body: any = { model, input: combined, temperature: 0.2, max_output_tokens: 1200 };
      if (model.startsWith("o3")) body.reasoning = { effort: "high" };
      const res = await client.responses.create(body);
      const answer = (res as any).output_text?.trim() ?? "";
      if (!answer) return fallback();
      return NextResponse.json({ answer });
    } catch {
      return fallback();
    }
  } catch (err) {
    console.error("/api/ai/chat error", err);
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }
}

