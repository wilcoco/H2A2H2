import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = await req.json().catch(() => ({}));
    const qaId: string = (body?.qaId ?? "").toString();
    const answer: string | undefined = typeof body?.answer === "string" ? String(body.answer) : undefined;
    let summary: string | undefined = typeof body?.summary === "string" ? String(body.summary) : undefined;
    const patch: any | undefined = body?.patch ?? undefined;
    if (!qaId || (!((answer || "").trim()) && !(summary && summary.trim()))) {
      return NextResponse.json({ error: "Missing answer or summary" }, { status: 400 });
    }

    // derive summary fallback if not provided but answer exists
    if (!summary && (answer || "").trim()) {
      try {
        if (patch?.description && typeof patch.description === "string") summary = String(patch.description).slice(0, 280);
        else summary = (answer as string).replace(/\s+/g, " ").slice(0, 280);
      } catch {}
    }

    await withConn(async (c) => {
      await c.query(
        `update qa_entries set answer = coalesce($2, answer), summary = coalesce($3, summary), patch = coalesce($4, patch) where id = $1`,
        [qaId, (answer || "").trim() ? answer : null, summary ?? null, patch ?? null]
      );
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
