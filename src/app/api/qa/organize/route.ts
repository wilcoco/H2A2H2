// /api/qa/organize
//  GET    ?rootId=...                 → 이 가지의 정리 페이지 리스트 (보통 본인 0~1개 + 다른 사람들 0~N개)
//  POST   { rootId, draftOnly: true } → AI가 정리 페이지 초안 생성 (저장 안 함, quota 1회 차감)
//  POST   { rootId, title, summary_line, body, keywords, category, verification_candidates, draftOnly: false }
//                                     → 본인 정리 페이지 저장 (없으면 신규, 있으면 갱신)
//  POST   { action: "fork", sourceId } → 다른 사람의 정리를 본인 것으로 복사
//  DELETE ?id=...                     → 본인 정리 삭제

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { organizeBranch, OrganizedSchema } from "@/lib/llm/organize";
import { QuotaExhausted } from "@/lib/llm/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function uuid(): string {
  return "org_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const PostBody = z.union([
  z.object({
    rootId: z.string().min(1),
    draftOnly: z.literal(true),
    preferByok: z.boolean().optional(),
  }),
  z.object({
    rootId: z.string().min(1),
    draftOnly: z.literal(false).optional().default(false),
    ...OrganizedSchema.shape,
  }),
  z.object({
    action: z.literal("fork"),
    sourceId: z.string().min(1),
  }),
]);

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const url = new URL(req.url);
    const rootId = url.searchParams.get("rootId");
    if (!rootId) return NextResponse.json({ items: [] });
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;

    const rows = await withConn(async (c) => {
      const r = await c.query(
        `select id, root_id, title, summary_line, body, keywords, category, source_qa_ids,
                verification_candidates, organized_by, organized_at, updated_at, is_locked, forked_from, view_count
           from organized_pages where root_id = $1 order by organized_at asc`,
        [rootId]
      );
      return r.rows;
    });

    const items = rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      rootId: r.root_id,
      title: r.title,
      summaryLine: r.summary_line,
      body: r.body,
      keywords: r.keywords,
      category: r.category,
      sourceQaIds: r.source_qa_ids,
      verificationCandidates: r.verification_candidates,
      organizedBy: r.organized_by,
      organizedAt: r.organized_at,
      updatedAt: r.updated_at,
      isLocked: r.is_locked,
      forkedFrom: r.forked_from,
      viewCount: r.view_count,
      isMine: user?.email === r.organized_by,
    }));

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const input = PostBody.parse(await req.json());

    // === fork ===
    if ("action" in input && input.action === "fork") {
      const src = await withConn(async (c) => {
        const r = await c.query(`select * from organized_pages where id = $1`, [input.sourceId]);
        return r.rows[0] as Record<string, unknown> | undefined;
      });
      if (!src) return NextResponse.json({ error: "source not found" }, { status: 404 });

      const id = uuid();
      await withConn(async (c) => {
        await c.query(
          `insert into organized_pages
             (id, root_id, title, summary_line, body, keywords, category, source_qa_ids,
              verification_candidates, organized_by, forked_from)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           on conflict (root_id, organized_by) do update
             set title = excluded.title,
                 summary_line = excluded.summary_line,
                 body = excluded.body,
                 keywords = excluded.keywords,
                 category = excluded.category,
                 source_qa_ids = excluded.source_qa_ids,
                 verification_candidates = excluded.verification_candidates,
                 forked_from = excluded.forked_from,
                 updated_at = now()`,
          [
            id, src.root_id, src.title, src.summary_line, src.body,
            src.keywords, src.category, src.source_qa_ids,
            src.verification_candidates, user.email, src.id,
          ]
        );
      });
      return NextResponse.json({ ok: true, id, forkedFrom: input.sourceId });
    }

    // === draftOnly (AI 자동 정리 초안만 반환, 저장 안 함) ===
    if ("draftOnly" in input && input.draftOnly === true) {
      try {
        const out = await organizeBranch(user.email, input.rootId, { preferByok: input.preferByok });
        return NextResponse.json({ draft: out.draft, meta: out.meta });
      } catch (e) {
        if (e instanceof QuotaExhausted) {
          return NextResponse.json({ error: "quota_exhausted", message: "오늘의 무료 호출이 끝났어요. 본인 API 키를 등록하거나 포인트로 계속 쓸 수 있어요." }, { status: 429 });
        }
        const msg = e instanceof Error ? e.message : "organize_failed";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    // === 저장 (신규 또는 본인 정리 갱신) ===
    if (!("rootId" in input)) {
      return NextResponse.json({ error: "rootId required" }, { status: 400 });
    }
    const data = input as z.infer<typeof OrganizedSchema> & { rootId: string };

    const sourceQaIds = await withConn(async (c) => {
      const r = await c.query(
        `select id from qa_entries where coalesce(root_id, id) = $1 order by created_at asc limit 50`,
        [data.rootId]
      );
      return (r.rows as Array<{ id: string }>).map((x) => x.id);
    });

    const id = uuid();
    const result = await withConn(async (c) => {
      const r = await c.query(
        `insert into organized_pages
           (id, root_id, title, summary_line, body, keywords, category, source_qa_ids,
            verification_candidates, organized_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (root_id, organized_by) do update
           set title = excluded.title,
               summary_line = excluded.summary_line,
               body = excluded.body,
               keywords = excluded.keywords,
               category = excluded.category,
               source_qa_ids = excluded.source_qa_ids,
               verification_candidates = excluded.verification_candidates,
               updated_at = now()
         returning id, (xmax = 0) as inserted`,
        [
          id, data.rootId, data.title, data.summary_line, data.body || "",
          data.keywords, data.category || null, sourceQaIds,
          JSON.stringify(data.verification_candidates || []),
          user.email,
        ]
      );
      return r.rows[0] as { id: string; inserted: boolean };
    });

    return NextResponse.json({ ok: true, id: result.id, inserted: result.inserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    await withConn(async (c) => {
      await c.query(`delete from organized_pages where id = $1 and organized_by = $2`, [id, user.email]);
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
