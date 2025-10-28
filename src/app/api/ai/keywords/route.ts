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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || text.trim().length === 0) {
      const kws = heuristic(text, max);
      return NextResponse.json({ keywords: kws });
    }

    try {
      const client = new OpenAI({ apiKey });
      const prompt = `Extract ${max} concise keywords or short phrases (2-4 words) from the following text. Return ONLY a JSON object: {\n  "keywords": string[]\n}\nText:\n${text}`;
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You extract keywords. Output valid JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      });
      const content = completion.choices?.[0]?.message?.content ?? "";
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
