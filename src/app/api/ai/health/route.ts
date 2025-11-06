import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const provider = process.env.AI_PROVIDER || "openai";
  const hasKeyOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasKeyAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const openaiModel = process.env.OPENAI_MODEL || "gpt-4o";
  const anthropicModel = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
  const hasKey = hasKeyOpenAI; // backward-compat
  const model = provider === "anthropic" ? anthropicModel : openaiModel; // shown model based on provider
  return NextResponse.json({
    ok: true,
    provider,
    hasKey,
    model: (provider === "anthropic" ? (hasKeyAnthropic ? model : null) : (hasKeyOpenAI ? model : null)),
    keys: { openai: hasKeyOpenAI, anthropic: hasKeyAnthropic },
    models: { openai: openaiModel, anthropic: anthropicModel },
  });
}
