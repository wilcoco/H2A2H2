// 일반 사용자용 단순 LLM 호출 라우트.
// 라우터(free/point/byok 자동 결정) + quota 차감/적립.
// 응답은 답 + 사용된 tier + 갱신된 quota.
//
// 기존 /api/ai/chat은 refine·컨텍스트 합성 등 거대한 로직을 가짐 — 고급 모드 사용자 흐름용.
// /api/ai/ask는 카드 피드/대중 사용자 흐름용으로 깔끔하게.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { routeAndCall, QuotaExhausted } from "@/lib/llm/router";
import { buildRag } from "@/lib/llm/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().min(1).max(2000),
  detail: z.enum(["short", "normal", "long"]).optional().default("normal"),
  preferByok: z.boolean().optional().default(false),
  preferredProvider: z.enum(["openai", "anthropic"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const email = user?.email ?? null;
    const input = Body.parse(await req.json());

    // 가벼운 컨텍스트 — 같은 질문 텍스트로 기존 답이 이미 있는지 확인 (있으면 그걸 알려서 LLM 호출 절약)
    const existing = await withConn(async (c) => {
      const q = input.question.trim().toLowerCase();
      try {
        const r = await c.query(
          `select id, question, summary, answer from qa_entries
            where published = true and similarity(lower(question), $1) > 0.6
            order by similarity(lower(question), $1) desc limit 1`,
          [q]
        );
        return r.rows[0] as { id: string; question: string; summary: string | null; answer: string | null } | undefined;
      } catch {
        // pg_trgm 없으면 폴백
        const r = await c.query(
          `select id, question, summary, answer from qa_entries
            where published = true and lower(question) like ('%' || $1 || '%')
            order by created_at desc limit 1`,
          [q]
        );
        return r.rows[0] as { id: string; question: string; summary: string | null; answer: string | null } | undefined;
      }
    });

    if (existing) {
      // 기존 답 재활용 — LLM 호출 안 함 (quota 영향 없음)
      return NextResponse.json({
        answer: existing.summary || existing.answer || "",
        existingQaId: existing.id,
        reused: true,
        tier: null,
      });
    }

    const styleLine = input.detail === "short"
      ? "Be concise. Aim for 3–5 sentences."
      : input.detail === "long"
      ? "Be thorough and well-structured."
      : "Be balanced and complete.";
    const system = `You are a helpful assistant. Answer in the user's language. Provide ONLY the final answer. ${styleLine}`;

    const maxTokens = input.detail === "long" ? 2200 : input.detail === "short" ? 700 : 1300;

    // W3: LLM wiki RAG — 같은 vault의 정리된 페이지(직접 매칭 + cross-link 1-hop)를
    // 컨텍스트로 자동 주입. 시스템이 누적된 지식을 받아쓰기 함 → LLM 비용↓ 품질↑.
    const rag = await buildRag(input.question);
    const userText = rag.contextText
      ? `${rag.contextText}\n\n---\n\nUser question: ${input.question}`
      : input.question;

    try {
      const result = await routeAndCall(
        email,
        { system, user: userText, maxTokens, temperature: 0.3 },
        { preferByok: input.preferByok, preferredProvider: input.preferredProvider }
      );
      return NextResponse.json({
        answer: result.text,
        reused: false,
        tier: result.tier,
        modelUsed: result.modelUsed,
        providerUsed: result.providerUsed,
        responseId: result.responseId,
        quota: result.quotaAfter,
        ragSources: rag.sources,
      });
    } catch (e) {
      if (e instanceof QuotaExhausted) {
        return NextResponse.json({
          error: "quota_exhausted",
          message: "오늘의 무료 호출이 끝났어요. 다른 사람의 답에 👍를 받거나, 본인 API 키를 등록하면 계속 쓸 수 있습니다.",
        }, { status: 429 });
      }
      const msg = e instanceof Error ? e.message : "ai_call_failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
