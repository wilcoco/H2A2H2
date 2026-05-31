import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

function uuid(): string {
  return "qa_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = await req.json().catch(() => ({}));
    const question: string = (body?.question ?? "").toString();
    const answer: string | undefined = body?.answer ? String(body.answer) : undefined;
    let summary: string | undefined = body?.summary ? String(body.summary) : undefined;
    const patch: Record<string, unknown> | undefined = body?.patch ?? undefined;
    const workId: string | undefined = body?.workId ? String(body.workId) : undefined;
    const responseId: string | undefined = body?.responseId ? String(body.responseId) : undefined;
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const createdBy: string | undefined = user?.email ?? undefined;
    const parentId: string | undefined = body?.parentId ? String(body.parentId) : undefined;
    const intentL1: string | undefined = body?.intentL1 ? String(body.intentL1) : undefined;
    const intentL2: string | undefined = body?.intentL2 ? String(body.intentL2) : undefined;
    const targetPIC: string | undefined = body?.targetPIC ? String(body.targetPIC) : undefined;
    const published: boolean = body?.published === true ? true : false;

    const q = question.trim();
    if (!q) return NextResponse.json({ error: "Missing question" }, { status: 400 });

    // server-side summary fallback (no truncation)
    if (!summary) {
      try {
        if (patch?.description && typeof patch.description === "string") {
          summary = String(patch.description);
        } else if (answer) {
          summary = answer.replace(/\s+/g, " ");
        }
      } catch {}
    }

    const id = uuid();
    let rootId: string | null = null;
    if (parentId) {
      const parent = await withConn(async (c) => {
        const r = await c.query(`select id, root_id from qa_entries where id = $1`, [parentId]);
        return (r.rows?.[0] ?? null) as { id?: unknown; root_id?: unknown } | null;
      });
      if (parent) {
        const rid = typeof parent.root_id === 'string' ? parent.root_id : undefined;
        const pid = typeof parent.id === 'string' ? parent.id : undefined;
        rootId = rid || pid || null;
      }
    }
    await withConn(async (c) => {
      await c.query(
        `insert into qa_entries (id, question, norm_question, answer, summary, patch, work_id, created_by, parent_id, root_id, published, last_response_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, q, normalize(q), answer ?? null, summary ?? null, patch ?? null, workId ?? null, createdBy ?? null, parentId ?? null, rootId ?? id, published, (responseId || "").trim() ? responseId : null]
      );

      if (parentId) {
        const relationType = (() => {
          const l2 = (intentL2 || "").toLowerCase();
          const l1 = (intentL1 || "").toLowerCase();
          if (l2) {
            if (["clarify", "troubleshoot", "verify", "risk"].includes(l2)) return "clarifies";
            if (["detail", "example", "summarize", "adapt", "localize"].includes(l2)) return "elaborates";
            if (["justify", "metrics"].includes(l2)) return "prerequisite";
            if (["compare", "alternative", "reframe"].includes(l2)) return "alternative";
            if (["implement", "plan"].includes(l2)) return "precedes";
          }
          if (l1) {
            if (["expansion"].includes(l1)) return "clarifies";
            if (["contingency", "evidence", "attribution"].includes(l1)) return "supports";
            if (["comparison"].includes(l1)) return "alternative";
            if (["temporal", "sequence"].includes(l1)) return "precedes";
            if (["evaluation", "verification"].includes(l1)) return "clarifies";
          }
          return "clarifies";
        })();
        await c.query(
          `insert into qa_relations (source_id, target_id, type, weight, created_by)
           values ($1,$2,$3,$4,$5)
           on conflict (source_id, target_id, type)
           do update set weight = excluded.weight, created_by = excluded.created_by, created_at = now()`,
          [parentId, id, relationType, 1, createdBy ?? null]
        );

        if (intentL1 || intentL2 || targetPIC) {
          const intentId = "intent_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
          await c.query(
            `insert into qa_intents (id, child_id, parent_id, l1, l2, target_pic, created_by)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [intentId, id, parentId, intentL1 ?? null, intentL2 ?? null, targetPIC ?? null, createdBy ?? null]
          );
        }
      }
    });

    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: "Failed to share" }, { status: 500 });
  }
}
