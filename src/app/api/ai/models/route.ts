import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" });
    const client = new OpenAI({ apiKey });
    const models = await client.models.list();
    const ids = models.data.map((m: any) => m.id).sort();
    const chat = ids.filter((id: string) => /^(o3|o4|gpt-4o|gpt-4|gpt-3\.5)/.test(id));
    return NextResponse.json({ ok: true, chat, all: ids });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Failed to list models" }, { status: 500 });
  }
}
