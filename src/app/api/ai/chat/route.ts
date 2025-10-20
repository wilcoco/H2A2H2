import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

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

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: "You are a helpful assistant. Answer concisely in the user's language." },
      ...input.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: input.prompt || "" },
    ];

    try {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.5,
      });
      const answer = completion.choices?.[0]?.message?.content ?? "";
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
