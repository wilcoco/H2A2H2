import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";

function uuid(prefix = "qa_"): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function POST(req: NextRequest) {
  try {
    // Dev-only guard
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
    }
    await ensureTables();

    // Optional custom root question via body
    const body = await req.json().catch(() => ({}));
    const rootQ: string = (body?.rootQuestion ?? "데모: 후속 질문 마인드맵을 테스트하려면 Follow-ups를 눌러보세요").toString();

    const rootId = uuid();
    const now = new Date();

    await withConn(async (c) => {
      // Root QA with an answer
      await c.query(
        `insert into qa_entries (id, question, norm_question, answer, summary, patch, work_id, created_by, parent_id, root_id, created_at)
         values ($1,$2,$3,$4,$5,null,null,$6,null,$1,$7)`,
        [rootId, rootQ, normalize(rootQ), "이것은 데모 루트 답변입니다.", "데모 스레드의 루트입니다.", "demo@system", now]
      );

      // Level 2: two children under root
      const ch1 = uuid();
      const ch2 = uuid();
      await c.query(
        `insert into qa_entries (id, question, norm_question, summary, parent_id, root_id, created_by, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8),
                ($9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          ch1, "데모: 첫 번째 후속 질문", normalize("데모: 첫 번째 후속 질문"), "레벨 2 노드", rootId, rootId, "demo@system", now,
          ch2, "데모: 두 번째 후속 질문", normalize("데모: 두 번째 후속 질문"), "레벨 2 노드", rootId, rootId, "demo@system", now,
        ]
      );

      // Level 3: one grandchild under ch1
      const gch1 = uuid();
      await c.query(
        `insert into qa_entries (id, question, norm_question, parent_id, root_id, created_by, created_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [gch1, "데모: 3단계 후속 질문", normalize("데모: 3단계 후속 질문"), ch1, rootId, "demo@system", now]
      );
    });

    return NextResponse.json({ rootId });
  } catch (e) {
    return NextResponse.json({ error: "Seed failed" }, { status: 500 });
  }
}
