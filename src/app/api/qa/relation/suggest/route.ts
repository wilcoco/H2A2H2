import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORE_TYPES = [
  "narrows",
  "elaborates",
  "clarifies",
  "prerequisite",
  "precedes",
  "supports",
  "refutes",
  "alternative",
] as const;

type CoreType = (typeof CORE_TYPES)[number];

type SuggestionOut = {
  sourceId: string;
  targetId: string;
  type: CoreType;
  confidence: number;
  rationale: string;
  providerUsed: "openai" | "anthropic" | "fallback";
  modelUsed?: string;
};

const RequestSchema = z.object({
  aId: z.string().min(1),
  bId: z.string().min(1),
  provider: z.enum(["openai", "anthropic"]).optional(),
});

const ModelResult = z.object({
  type: z.enum(CORE_TYPES),
  direction: z.enum(["a_to_b", "b_to_a"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(280),
});

type QaRow = { id: string; question: string; answer?: string | null; summary?: string | null };

type OpenAIResponsesCreateParams = Parameters<InstanceType<typeof OpenAI>["responses"]["create"]>[0];

function openAiOutputText(res: unknown): string {
  const v = (res as { output_text?: unknown } | null | undefined)?.output_text;
  return typeof v === "string" ? v.trim() : "";
}

function clip(s: string, max: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

function fallback(aId: string, bId: string): SuggestionOut {
  return {
    sourceId: aId,
    targetId: bId,
    type: "precedes",
    confidence: 0.2,
    rationale: "AI 사용 불가로 기본값(precedes)을 제안합니다.",
    providerUsed: "fallback",
  };
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json().catch(() => ({}));
    const input = RequestSchema.parse(json);
    const aId = input.aId.trim();
    const bId = input.bId.trim();
    if (!aId || !bId) return NextResponse.json({ error: "Missing ids" }, { status: 400 });
    if (aId === bId) return NextResponse.json({ error: "aId==bId" }, { status: 400 });

    await ensureTables();

    const rows = await withConn(async (c) => {
      const r = await c.query(
        `select id, question, answer, summary from qa_entries where id = any($1)`,
        [[aId, bId]]
      );
      return r.rows as QaRow[];
    });

    const byId = new Map<string, QaRow>();
    for (const r of rows) {
      if (r?.id) byId.set(String(r.id), r);
    }
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) return NextResponse.json({ error: "QA not found" }, { status: 404 });

    const provider = input.provider ?? ((process.env.AI_PROVIDER as "openai" | "anthropic" | undefined) ?? "openai");
    const openaiKey = process.env.OPENAI_API_KEY;
    const antKey = process.env.ANTHROPIC_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o";
    const anthropicModel = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

    const aQ = clip(String(a.question || ""), 240);
    const bQ = clip(String(b.question || ""), 240);
    const aA = clip(String(a.summary || a.answer || ""), 520);
    const bA = clip(String(b.summary || b.answer || ""), 520);

    const system = `You classify the relationship between two Q&A entries A and B.
Pick exactly one relation type from: ${CORE_TYPES.join(", ")}.
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

    const userText = `A.id=${aId}\nA.question=${aQ}\nA.answer_or_summary=${aA || "(none)"}\n\nB.id=${bId}\nB.question=${bQ}\nB.answer_or_summary=${bA || "(none)"}`;

    const runOpenAI = async (): Promise<{ res: z.infer<typeof ModelResult>; modelUsed: string } | null> => {
      if (!openaiKey) return null;
      const client = new OpenAI({ apiKey: openaiKey });
      const body: Record<string, unknown> = {
        model,
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
                type: { type: "string", enum: CORE_TYPES as unknown as string[] },
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
        const res = ModelResult.parse(parsed);
        return { res, modelUsed: model };
      } catch {
        if (model !== "gpt-4o") {
          try {
            const rr = await client.responses.create({ ...body, model: "gpt-4o" } as unknown as OpenAIResponsesCreateParams);
            const text = openAiOutputText(rr);
            if (!text) return null;
            const parsed = JSON.parse(text);
            const res = ModelResult.parse(parsed);
            return { res, modelUsed: "gpt-4o" };
          } catch {
            return null;
          }
        }
        return null;
      }
    };

    const runAnthropic = async (): Promise<{ res: z.infer<typeof ModelResult>; modelUsed: string } | null> => {
      if (!antKey) return null;
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
        const res = ModelResult.parse(parsed);
        return { res, modelUsed: anthropicModel };
      } catch {
        return null;
      }
    };

    let result: { res: z.infer<typeof ModelResult>; modelUsed: string } | null = null;
    let providerUsed: "openai" | "anthropic" | "fallback" = "fallback";

    if (provider === "anthropic") {
      result = await runAnthropic();
      if (result) providerUsed = "anthropic";
      else {
        result = await runOpenAI();
        if (result) providerUsed = "openai";
      }
    } else {
      result = await runOpenAI();
      if (result) providerUsed = "openai";
      else {
        result = await runAnthropic();
        if (result) providerUsed = "anthropic";
      }
    }

    if (!result) {
      return NextResponse.json(fallback(aId, bId));
    }

    const dir = result.res.direction;
    const sourceId = dir === "a_to_b" ? aId : bId;
    const targetId = dir === "a_to_b" ? bId : aId;

    const out: SuggestionOut = {
      sourceId,
      targetId,
      type: result.res.type,
      confidence: result.res.confidence,
      rationale: result.res.rationale,
      providerUsed,
      modelUsed: result.modelUsed,
    };

    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }
}
