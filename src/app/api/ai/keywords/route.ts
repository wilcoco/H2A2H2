import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function heuristic(text: string, max = 6): string[] {
  const stop = new Set([
    "the","a","an","and","or","of","to","in","on","for","with","is","are","was","were","be","as","by","at","from","that","this","it","we","you","they","i","how","what","why","when","where",
    "은","는","이","가","을","를","에","의","도","과","와","들","에서","하다","했다","인가","인데","하면","하려고","어떻게","무엇","왜","언제","어디",
  ]);
  function normalizeKo(s: string): string {
    const t = (s || "").trim().toLowerCase();
    if (!t) return t;
    const josa = [
      "에서","에게","으로","하면","하며","라고","이라면","이랑","처럼","부터","까지","조차","마저","뿐","이라서","라서","이라며","이며",
      "은","는","이","가","을","를","과","와","로","에","도","만","나","이나","라도","라면","랑","엔","의"
    ];
    for (const j of josa.sort((a,b) => b.length - a.length)) {
      if (t.endsWith(j) && t.length > j.length + 1) return t.slice(0, t.length - j.length);
    }
    return t;
  }
  const raw = (text || "").toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").split(/\s+/);
  const tokens = raw.map((w) => normalizeKo(w)).filter((t) => t.length >= 2 && !stop.has(t));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const out: string[] = [];
  for (const t of sorted) { if (!out.includes(t)) out.push(t); if (out.length >= max) break; }
  return out;
}

function phraseHeuristic(text: string, max = 6): string[] {
  function normalizeKoToken(s: string): string {
    const t = (s || "").trim().toLowerCase();
    if (!t) return t;
    const josa = [
      "에서","에게","으로","하면","하며","라고","이라면","이랑","처럼","부터","까지","조차","마저","뿐","이라서","라서","이라며","이며",
      "은","는","이","가","을","를","과","와","로","에","도","만","나","이나","라도","라면","랑","엔","의"
    ];
    for (const j of josa.sort((a,b) => b.length - a.length)) {
      if (t.endsWith(j) && t.length > j.length + 1) return t.slice(0, t.length - j.length);
    }
    return t;
  }
  const rawTokens = (text || "").toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").split(/\s+/).filter(Boolean);
  const tokens = rawTokens.map(normalizeKoToken).filter((t) => t.length >= 2);
  const ngrams: string[] = [];
  const maxN = 4;
  for (let n = 2; n <= Math.min(maxN, tokens.length); n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const gram = tokens.slice(i, i + n).join(" ");
      ngrams.push(gram);
    }
  }
  const freq = new Map<string, number>();
  for (const g of ngrams) freq.set(g, (freq.get(g) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const out: string[] = [];
  for (const t of sorted) { if (!out.includes(t)) out.push(t); if (out.length >= max) break; }
  return out;
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
      const phs = phraseHeuristic(text, Math.min(6, max));
      return NextResponse.json({ keywords: kws, phrases: phs });
    }

    try {
      const client = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
      const model = process.env.OPENAI_MODEL || "gpt-4o";
      const prompt = `Extract keywords from the text. Return ONLY valid JSON: {"keywords": string[], "phrases": string[]}.
Rules:
- keywords: up to ${max} single-word base forms (no particles in Korean)
- phrases: up to ${Math.min(6, max)} multi-word phrases (2-4 words)
Text:\n${text}`;
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
        const arr: string[] = Array.isArray(parsed?.keywords) ? (parsed.keywords as any[]).map((s: unknown) => String(s)).filter(Boolean) : [];
        const phr: string[] = Array.isArray(parsed?.phrases) ? (parsed.phrases as any[]).map((s: unknown) => String(s)).filter(Boolean) : [];
        // Normalize words to base forms
        const pieces: string[] = arr.flatMap((s: string) => s.split(/[\s,\/_-]+/).map((t: string) => t.trim()).filter(Boolean));
        const base: string[] = pieces.map((w: string) => w.toLowerCase());
        const normWords = heuristic(base.join(" "), max * 2);
        // Normalize phrases as-is and dedupe
        const normPhrases = phraseHeuristic(phr.join(" \n"), Math.min(6, max));
        const outWords: string[] = [];
        for (const t of normWords) { if (!outWords.includes(t)) outWords.push(t); if (outWords.length >= max) break; }
        const outPhrases: string[] = [];
        for (const p of normPhrases) { if (!outPhrases.includes(p)) outPhrases.push(p); if (outPhrases.length >= Math.min(6, max)) break; }
        if (outWords.length > 0 || outPhrases.length > 0) return NextResponse.json({ keywords: outWords, phrases: outPhrases });
      } catch {}
      const kws = heuristic(text, max);
      const phs = phraseHeuristic(text, Math.min(6, max));
      return NextResponse.json({ keywords: kws, phrases: phs });
    } catch {
      const kws = heuristic(text, max);
      const phs = phraseHeuristic(text, Math.min(6, max));
      return NextResponse.json({ keywords: kws, phrases: phs });
    }
  } catch {
    return NextResponse.json({ keywords: [], phrases: [] });
  }
}

