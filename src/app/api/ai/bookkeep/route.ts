import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { ensureTables, withConn } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Karpathy LLM Wiki" 식 자동 북키핑 + nightwish "수렴 거부".
// 입력 qaId에 대해 같은 가지(root_id)의 다른 노드들을 LLM이 분석해서:
//  - summary_update: 새 답이 가지 안에서 어떻게 자리잡는지의 짧은 요약(있으면 채택 제안)
//  - relations:      기존 노드와의 관계 후보 (clarifies/supports/refutes/elaborates/alternative ...)
//  - fork_candidates: 모순이 분명한 부분에 대해 fork 권장 (reconcile 하지 않음)
//  - notes:          다른 노드에 부착할 짧은 노트 후보
// 자동 적용하지 않음. 사용자가 UI에서 개별 승인.

const Body = z.object({ qaId: z.string().min(1) });

const Relation = z.object({
  targetQaId: z.string(),
  type: z.enum(["supports", "refutes", "clarifies", "elaborates", "alternative", "prerequisite", "precedes", "narrows"]),
  rationale: z.string().min(1).max(240),
  confidence: z.number().min(0).max(1),
});
const ForkCandidate = z.object({
  reason: z.string().min(1).max(280),
  draftAnswer: z.string().min(1).max(2000),
});
const Note = z.object({
  qaId: z.string(),
  content: z.string().min(1).max(600),
});
const Out = z.object({
  summary_update: z.string().max(800).optional().default(""),
  relations: z.array(Relation).max(8).optional().default([]),
  fork_candidates: z.array(ForkCandidate).max(3).optional().default([]),
  notes: z.array(Note).max(6).optional().default([]),
});

const SYS = `You are a knowledge graph bookkeeper for an "ontology of questions and answers".
You are given ONE new node (Q,A) and the OTHER nodes already in its branch.

Your job is NOT to reconcile contradictions. If two nodes disagree on substance,
DO NOT rewrite either of them. Instead emit a "fork_candidate" — propose a separate
competing branch. The system preserves both (Galileo branch policy).

For non-contradictory new context, emit:
- summary_update: a short refreshed summary of the NEW node only (<= 4 sentences, Korean if Korean Q),
- relations: candidate edges between the NEW node and EXISTING nodes (use exact targetQaId from input),
- notes: short side notes to attach to EXISTING nodes (clarifications, missing pointers).

Use the relation types: supports, refutes, clarifies, elaborates, alternative, prerequisite, precedes, narrows.
"refutes" or strong disagreement -> prefer fork_candidate (not relation).
Return ONLY valid JSON: { summary_update, relations, fork_candidates, notes }.`;

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const input = Body.parse(await req.json());

    const data = await withConn(async (c) => {
      const target = await c.query(
        `select id, question, answer, summary, coalesce(root_id, id) as root_id
           from qa_entries where id = $1 limit 1`,
        [input.qaId]
      );
      if (!target.rowCount) throw new Error("QA not found");
      const t = target.rows[0] as { id: string; question: string; answer: string | null; summary: string | null; root_id: string };
      const others = await c.query(
        `select id, question, summary, answer from qa_entries
          where coalesce(root_id, id) = $1 and id <> $2 and published = true
          order by created_at asc
          limit 20`,
        [t.root_id, t.id]
      );
      return {
        target: t,
        others: others.rows as Array<{ id: string; question: string; summary: string | null; answer: string | null }>,
      };
    });

    const fallback = () => NextResponse.json({
      summary_update: data.target.summary || (data.target.answer || "").slice(0, 280),
      relations: [],
      fork_candidates: [],
      notes: [],
      meta: { providerUsed: "fallback" },
    });

    const key = process.env.OPENAI_API_KEY;
    if (!key) return fallback();
    const client = new OpenAI({ apiKey: key });
    const model = process.env.OPENAI_MODEL || "gpt-4o";

    const targetTxt = `NEW (id=${data.target.id})\nQ: ${data.target.question}\nA: ${(data.target.answer || data.target.summary || "").slice(0, 1800)}`;
    const othersTxt = data.others
      .map((o, i) => `EXISTING #${i + 1} (id=${o.id})\nQ: ${o.question}\nA: ${(o.summary || o.answer || "").slice(0, 800)}`)
      .join("\n\n");
    const userText = `${targetTxt}\n\n${othersTxt || "(no other nodes in branch)"}`;

    try {
      const r = await client.responses.create({
        model,
        input: `${SYS}\n\n${userText}`,
        temperature: 0.2,
        max_output_tokens: 1400,
      });
      const out = (r as { output_text?: string }).output_text?.trim() ?? "";
      if (!out) return fallback();
      const cleaned = out.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      const validated = Out.parse(parsed);
      // 안전: relations.targetQaId가 실제로 가지 안 노드인지 필터링
      const validIds = new Set([data.target.id, ...data.others.map((o) => o.id)]);
      const relations = validated.relations.filter((rel) => validIds.has(rel.targetQaId) && rel.targetQaId !== data.target.id);
      const notes = validated.notes.filter((n) => validIds.has(n.qaId) && n.qaId !== data.target.id);
      return NextResponse.json({
        ...validated,
        relations,
        notes,
        meta: { providerUsed: "openai", modelUsed: model, otherCount: data.others.length },
      });
    } catch {
      return fallback();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
