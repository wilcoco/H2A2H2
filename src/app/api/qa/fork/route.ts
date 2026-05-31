import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({
  parentId: z.string().min(1),     // 같은 질문의 기존 답변 (포크 대상)
  answer: z.string().min(1),       // 다른 답변 (입증 책임을 지는 새 주장)
  summary: z.string().optional(),
  question: z.string().optional(), // 같은 질문이지만 변형 시 받을 수 있음
});

function uuid(): string {
  return "qa_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const input = Body.parse(await req.json());

    const result = await withConn(async (c) => {
      const r = await c.query(
        `select id, question, coalesce(root_id, id) as root_id from qa_entries where id = $1`,
        [input.parentId]
      );
      if (!r.rowCount) throw new Error("Parent QA not found");
      const parent = r.rows[0] as { id: string; question: string; root_id: string };
      const question = (input.question ?? parent.question).trim();
      const id = uuid();

      await c.query(
        `insert into qa_entries (id, question, norm_question, answer, summary, work_id, created_by, parent_id, root_id, published, forked_from, status)
         values ($1,$2,$3,$4,$5,null,$6,$7,$8,true,$9,'active')`,
        [id, question, normalize(question), input.answer, input.summary ?? null, user.email, parent.id, parent.root_id, parent.id]
      );

      // 포크는 '대안(alternative)' 관계로 부모와 연결 (수렴 거부 신호)
      await c.query(
        `insert into qa_relations (source_id, target_id, type, weight, created_by)
         values ($1, $2, 'alternative', 1, $3)
         on conflict (source_id, target_id, type)
         do update set weight = excluded.weight, created_by = excluded.created_by, created_at = now()`,
        [id, parent.id, user.email]
      );

      return { id, rootId: parent.root_id, forkedFrom: parent.id };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
