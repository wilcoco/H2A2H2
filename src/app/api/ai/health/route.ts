import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  return NextResponse.json({ ok: true, hasKey, model: hasKey ? model : null });
}
