import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  return NextResponse.json({ ok: true, hasKey, model: hasKey ? "gpt-4o-mini" : null });
}
