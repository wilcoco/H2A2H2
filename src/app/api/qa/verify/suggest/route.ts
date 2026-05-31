import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { classifyDirection } from "@/lib/nightwish/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

const Suggestion = z.object({
  metric: z.string().min(1).max(120),
  baseline: z.number(),
  observed: z.number(),
  unit: z.string().max(40).optional().default(""),
  direction: z.enum(["higher_better", "lower_better"]).optional(),
  minRelImprovement: z.number().min(0).max(1).optional().default(0.2),
  rationale: z.string().min(1).max(280),
});

type SuggestionT = z.infer<typeof Suggestion>;

const SuggestionList = z.object({
  suggestions: z.array(Suggestion).max(5),
});

const SYS = `You extract *externally verifiable* metrics from an AI answer to a question.
Pick measurements whose truth can be checked by physical or numerical reality
(yield %, defect rate, latency ms, cost, throughput, test pass rate, MTBF, ...).
NEVER pick "user satisfaction" or other consent-based metrics.
If the answer has no externally verifiable claim, return suggestions: [].
For each suggestion return: metric (English snake_case OK), baseline (status quo),
observed (claimed/expected outcome), unit, direction (higher_better or lower_better),
minRelImprovement (0..1, default 0.2 = 20%), rationale (Korean, 1 sentence).
Return ONLY valid JSON: { "suggestions": [...] } with at most 3 items.`;

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const input = Body.parse(json);
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      // 폴백: 휴리스틱 — 답변에 숫자+단위 패턴이 있으면 단순 제안
      return NextResponse.json({ suggestions: heuristicSuggest(input.answer) });
    }

    const client = new OpenAI({ apiKey: key });
    const model = process.env.OPENAI_MODEL || "gpt-4o";
    const userText = `Question: ${input.question}\n\nAnswer:\n${input.answer}`;

    try {
      const r = await client.responses.create({
        model,
        input: `${SYS}\n\n${userText}`,
        temperature: 0.1,
        max_output_tokens: 700,
      });
      const out = (r as { output_text?: string }).output_text?.trim() ?? "";
      if (!out) return NextResponse.json({ suggestions: heuristicSuggest(input.answer) });
      // 모델이 코드펜스를 둘러줄 수 있으니 추출
      const cleaned = out.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      const validated = SuggestionList.parse(parsed);
      const filled = validated.suggestions.map((s) => ({
        ...s,
        direction: s.direction ?? classifyDirection(s.metric),
      }));
      return NextResponse.json({ suggestions: filled });
    } catch {
      return NextResponse.json({ suggestions: heuristicSuggest(input.answer) });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message, suggestions: [] }, { status: 400 });
  }
}

function heuristicSuggest(answer: string): SuggestionT[] {
  // 숫자 %나 단위가 두 개 이상 있으면 첫 두 개로 baseline/observed 추정 (매우 약함)
  const matches = Array.from(answer.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*(%|ms|s|kg|MPa|°C|개|건)/g));
  if (matches.length < 2) return [];
  const baseline = Number(matches[0][1]);
  const observed = Number(matches[1][1]);
  const unit = matches[0][2];
  const metric = unit === "%" ? "rate" : unit === "ms" || unit === "s" ? "latency" : "value";
  const direction = classifyDirection(metric);
  return [{
    metric,
    baseline,
    observed,
    unit,
    direction,
    minRelImprovement: 0.2,
    rationale: "답변에서 발견한 숫자 두 개로 자동 추정 — 사용자가 검토·수정 필요.",
  }];
}
