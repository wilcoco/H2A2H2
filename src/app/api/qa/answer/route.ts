import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = await req.json().catch(() => ({}));
    const qaId: string = (body?.qaId ?? "").toString();
    const answer: string = (body?.answer ?? "").toString();
    const patch: any | undefined = body?.patch ?? undefined;
    if (!qaId || !answer.trim()) return NextResponse.json({ error: "Missing qaId or answer" }, { status: 400 });

    // derive summary fallback
    let summary: string | undefined = body?.summary ? String(body.summary) : undefined;
    if (!summary) {
      try {
        if (patch?.description && typeof patch.description === "string") summary = String(patch.description).slice(0, 280);
        else summary = answer.replace(/\s+/g, " ").slice(0, 280);
      } catch {}
    }

    await withConn(async (c) => {
      await c.query(
        `update qa_entries set answer = $2, summary = coalesce($3, summary), patch = coalesce($4, patch) where id = $1`,
        [qaId, answer, summary ?? null, patch ?? null]
      );
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
