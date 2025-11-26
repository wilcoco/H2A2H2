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
    const question: string | undefined = typeof body?.question === "string" ? String(body.question) : undefined;
    const patch: unknown = body?.patch ?? undefined;
    const responseId: string | undefined = typeof body?.responseId === "string" ? String(body.responseId) : undefined;
    const hasText = ((answer || "").trim().length > 0) || ((summary || "").trim().length > 0) || ((question || "").trim().length > 0);
    const hasPatch = patch !== undefined && patch !== null;
    if (!qaId || (!hasText && !hasPatch)) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // derive summary fallback if not provided but answer exists
    if (!summary && (answer || "").trim()) {
      try {
        if (patch && typeof patch === 'object' && patch !== null) {
          const desc = (patch as Record<string, unknown>)["description"];
          if (typeof desc === 'string') summary = desc.slice(0, 280);
          else summary = (answer as string).replace(/\s+/g, " ").slice(0, 280);
        } else {
          summary = (answer as string).replace(/\s+/g, " ").slice(0, 280);
        }
      } catch {}
    }

    function normalize(text: string): string { return text.toLowerCase().replace(/\s+/g, " ").trim(); }

    await withConn(async (c) => {
      await c.query(
        `update qa_entries
            set answer = coalesce($2, answer),
                summary = coalesce($3, summary),
                patch = coalesce($4, patch),
                question = coalesce($5, question),
                norm_question = case when $5 is not null and length(trim($5)) > 0 then $6 else norm_question end,
                last_response_id = coalesce($7, last_response_id)
          where id = $1`,
        [qaId, (answer || "").trim() ? answer : null, summary ?? null, patch ?? null, (question || "").trim() ? question : null, (question || "").trim() ? normalize(question as string) : null, (responseId || "").trim() ? responseId : null]
      );
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
