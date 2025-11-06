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
    const model = process.env.OPENAI_MODEL || "gpt-4o";

    const sys = "You are a helpful assistant. Answer concisely in the user's language.";
    const historyText = (input.history || [])
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");
    const promptText = input.prompt || "";
    const combined = `${sys}\n\n${historyText ? `Conversation:\n${historyText}\n\n` : ""}User: ${promptText}`;

    try {
      const body: any = { model, input: combined, temperature: 0.5 };
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

