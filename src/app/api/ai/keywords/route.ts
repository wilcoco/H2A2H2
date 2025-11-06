import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function heuristic(text: string, max = 6): string[] {
  const stop = new Set([
    // English
    "the","a","an","and","or","of","to","in","on","for","with","is","are","was","were","be","as","by","at","from","that","this","it","we","you","they","i","how","what","why","when","where",
    // Korean (basic)
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

export async function POST(req: NextRequest) {
  try {
    const json = await req.json().catch(() => ({}));
    const text = (json?.text ?? "").toString();
    const max = Math.max(1, Math.min(10, Number(json?.max ?? 6)));
    const provider = (json?.provider as "openai" | "anthropic" | undefined) ?? ((process.env.AI_PROVIDER as any) ?? "openai");

    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (text.trim().length === 0) {
      const kws = heuristic(text, max);
      return NextResponse.json({ keywords: kws });
    }

    try {
      const client = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
      const model = process.env.OPENAI_MODEL || "gpt-4o";
      const prompt = `You extract keywords. Output valid JSON only. Extract ${max} concise keywords or short phrases (2-4 words) from the following text.\nReturn ONLY a JSON object with shape {"keywords": string[]} and no extra keys or text.\nText:\n${text}`;
      let content = "";
      if (provider === "anthropic" && anthropicKey) {
        try {
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": anthropicKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
              system: "Return ONLY valid JSON with {\"keywords\": string[]}. No markdown.",
              max_tokens: 800,
              temperature: 0.2,
              messages: [
                { role: "user", content: [{ type: "text", text: prompt }] },
              ],
            }),
          });
          const j = await resp.json().catch(() => ({} as any));
          const parts: Array<{ type: string; text?: string }> = Array.isArray(j?.content) ? j.content : [];
          content = parts.filter((p) => p?.type === "text").map((p) => String(p.text || "")).join("\n");
        } catch {}
      }
      if (!content && client) {
        try {
          const body: any = { model, input: prompt, temperature: 0.2, max_output_tokens: 800 };
          if (model.startsWith("o3")) body.reasoning = { effort: "high" };
          body.response_format = {
            type: "json_schema",
            json_schema: {
              name: "Keywords",
              strict: true,
              schema: {
                type: "object",
                properties: { keywords: { type: "array", items: { type: "string" } } },
                required: ["keywords"],
                additionalProperties: false,
              },
            },
          };
          const res = await client.responses.create(body);
          content = (res as any).output_text ?? "";
        } catch {
          if (client && model !== "gpt-4o") {
            try {
              const res2 = await client.responses.create({ model: "gpt-4o", input: prompt, temperature: 0.2, max_output_tokens: 800 });
              content = (res2 as any).output_text ?? "";
            } catch {}
          }
        }
      }
      try {
        const parsed = JSON.parse(content ?? "{}");
        const arr = Array.isArray(parsed?.keywords) ? parsed.keywords.map((s: unknown) => String(s)).filter(Boolean) : [];
        if (arr.length > 0) return NextResponse.json({ keywords: arr.slice(0, max) });
      } catch {}
      const kws = heuristic(text, max);
      return NextResponse.json({ keywords: kws });
    } catch {
      const kws = heuristic(text, max);
      return NextResponse.json({ keywords: kws });
    }
  } catch {
    return NextResponse.json({ keywords: [] });
  }
}

