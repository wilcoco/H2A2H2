import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Karpathy LLM Wiki 식 export:
//  - index.md  : 카탈로그 (root별 가지·노드 목록)
//  - log.md    : append-only 활동 이력 (시간순)
//  - nodes/<id>.md : 노드별 페이지 (Q/A/요약/관계/검증)
//
// 단일 JSON 응답: { files: { path: contentString }, manifest }
// 클라이언트가 ZIP으로 묶거나 개별 다운로드.

type QaRow = {
  id: string;
  question: string;
  answer: string | null;
  summary: string | null;
  root_id: string | null;
  parent_id: string | null;
  forked_from: string | null;
  status: string | null;
  created_at: string;
  created_by: string | null;
};

type RelRow = { source_id: string; target_id: string; type: string };
type NoteRow = { qa_id: string; content: string; created_at: string; user_id: string | null };
type VerRow = {
  qa_id: string; metric: string; baseline: number; observed: number; unit: string | null;
  direction: string; passes: boolean; source_url: string | null; source_note: string | null;
  created_at: string;
};

function esc(s: string | null | undefined): string {
  return (s || "").replace(/\r\n/g, "\n").trim();
}

function fmtDate(s: string): string {
  try { return new Date(s).toISOString(); } catch { return s; }
}

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const scope = (url.searchParams.get("scope") || "mine") as "mine" | "all";

    const data = await withConn(async (c) => {
      const qaQuery = scope === "mine"
        ? `select id, question, answer, summary, root_id, parent_id, forked_from, status, created_at, created_by
             from qa_entries where created_by = $1 and published = true
             order by created_at asc`
        : `select id, question, answer, summary, root_id, parent_id, forked_from, status, created_at, created_by
             from qa_entries where published = true
             order by created_at asc`;
      const qaRes = await c.query(qaQuery, scope === "mine" ? [user.email] : []);
      const qa = qaRes.rows as QaRow[];
      const ids = qa.map((r) => r.id);
      if (ids.length === 0) {
        return { qa: [] as QaRow[], rels: [] as RelRow[], notes: [] as NoteRow[], vers: [] as VerRow[] };
      }
      const rels = await c.query(
        `select source_id, target_id, type from qa_relations where source_id = any($1) or target_id = any($1)`,
        [ids]
      );
      const notes = await c.query(
        `select qa_id, content, created_at, user_id from qa_notes where qa_id = any($1) order by created_at asc`,
        [ids]
      );
      const vers = await c.query(
        `select qa_id, metric, baseline, observed, unit, direction, passes, source_url, source_note, created_at
           from qa_verifications where qa_id = any($1) order by created_at asc`,
        [ids]
      );
      return {
        qa,
        rels: rels.rows as RelRow[],
        notes: notes.rows as NoteRow[],
        vers: vers.rows as VerRow[],
      };
    });

    // 인덱싱
    const relsByNode = new Map<string, RelRow[]>();
    for (const r of data.rels) {
      if (!relsByNode.has(r.source_id)) relsByNode.set(r.source_id, []);
      if (!relsByNode.has(r.target_id)) relsByNode.set(r.target_id, []);
      relsByNode.get(r.source_id)!.push(r);
      if (r.source_id !== r.target_id) relsByNode.get(r.target_id)!.push(r);
    }
    const notesByNode = new Map<string, NoteRow[]>();
    for (const n of data.notes) {
      if (!notesByNode.has(n.qa_id)) notesByNode.set(n.qa_id, []);
      notesByNode.get(n.qa_id)!.push(n);
    }
    const versByNode = new Map<string, VerRow[]>();
    for (const v of data.vers) {
      if (!versByNode.has(v.qa_id)) versByNode.set(v.qa_id, []);
      versByNode.get(v.qa_id)!.push(v);
    }
    const byId = new Map<string, QaRow>(data.qa.map((q) => [q.id, q]));
    const byRoot = new Map<string, QaRow[]>();
    for (const q of data.qa) {
      const rid = q.root_id || q.id;
      if (!byRoot.has(rid)) byRoot.set(rid, []);
      byRoot.get(rid)!.push(q);
    }

    const files: Record<string, string> = {};

    // index.md
    const indexLines: string[] = [
      `# Vault Index — ${scope === "mine" ? user.email : "all (public)"}`,
      "",
      `> exported at ${new Date().toISOString()}`,
      `> ${data.qa.length} nodes in ${byRoot.size} branches`,
      "",
    ];
    for (const [rid, nodes] of byRoot) {
      const root = byId.get(rid);
      const rootTitle = root?.question || rid;
      indexLines.push(`## ${rootTitle}`);
      indexLines.push(`- root: \`${rid}\``);
      indexLines.push(`- nodes: ${nodes.length}`);
      for (const n of nodes) {
        const tags: string[] = [];
        if (n.status === "dormant") tags.push("#dormant");
        if (n.forked_from) tags.push("#fork");
        const verified = (versByNode.get(n.id) || []).some((v) => v.passes);
        if (verified) tags.push("#verified");
        indexLines.push(`  - [[nodes/${n.id}]] · ${esc(n.question).slice(0, 80)} ${tags.join(" ")}`);
      }
      indexLines.push("");
    }
    files["index.md"] = indexLines.join("\n");

    // log.md (시간순)
    const logLines: string[] = [
      `# Vault Log — ${scope === "mine" ? user.email : "all (public)"}`,
      "",
      `> append-only; latest at bottom`,
      "",
    ];
    const events: Array<{ at: string; line: string }> = [];
    for (const q of data.qa) {
      events.push({ at: q.created_at, line: `- ${fmtDate(q.created_at)} · **node** ${q.id} (${q.created_by || "anon"}) — ${esc(q.question).slice(0, 100)}` });
    }
    for (const n of data.notes) {
      events.push({ at: n.created_at, line: `- ${fmtDate(n.created_at)} · note on ${n.qa_id} (${n.user_id || "anon"}) — ${esc(n.content).slice(0, 100)}` });
    }
    for (const v of data.vers) {
      events.push({ at: v.created_at, line: `- ${fmtDate(v.created_at)} · verify ${v.metric} ${v.baseline}→${v.observed}${v.unit || ""} on ${v.qa_id} ${v.passes ? "✓" : "✗"}` });
    }
    events.sort((a, b) => a.at.localeCompare(b.at));
    logLines.push(...events.map((e) => e.line));
    files["log.md"] = logLines.join("\n");

    // nodes/<id>.md
    for (const q of data.qa) {
      const lines: string[] = [];
      lines.push(`---`);
      lines.push(`id: ${q.id}`);
      lines.push(`root: ${q.root_id || q.id}`);
      if (q.parent_id) lines.push(`parent: ${q.parent_id}`);
      if (q.forked_from) lines.push(`forked_from: ${q.forked_from}`);
      lines.push(`status: ${q.status || "active"}`);
      lines.push(`created_at: ${q.created_at}`);
      lines.push(`created_by: ${q.created_by || ""}`);
      lines.push(`---`);
      lines.push("");
      lines.push(`# ${esc(q.question)}`);
      lines.push("");
      if (q.summary) { lines.push(`> ${esc(q.summary)}`); lines.push(""); }
      if (q.answer) { lines.push(`## Answer`); lines.push(""); lines.push(esc(q.answer)); lines.push(""); }
      const rels = relsByNode.get(q.id) || [];
      if (rels.length > 0) {
        lines.push(`## Relations`);
        for (const r of rels) {
          const arrow = r.source_id === q.id ? "→" : "←";
          const other = r.source_id === q.id ? r.target_id : r.source_id;
          lines.push(`- ${arrow} ${r.type} → [[nodes/${other}]]`);
        }
        lines.push("");
      }
      const vers = versByNode.get(q.id) || [];
      if (vers.length > 0) {
        lines.push(`## Verification (external anchor)`);
        for (const v of vers) {
          lines.push(`- ${v.passes ? "✓" : "✗"} **${v.metric}** ${v.baseline}${v.unit || ""} → ${v.observed}${v.unit || ""} (${v.direction})${v.source_url ? ` [src](${v.source_url})` : ""}${v.source_note ? ` — ${esc(v.source_note)}` : ""}`);
        }
        lines.push("");
      }
      const notes = notesByNode.get(q.id) || [];
      if (notes.length > 0) {
        lines.push(`## Notes`);
        for (const n of notes) {
          lines.push(`- (${fmtDate(n.created_at)}, ${n.user_id || "anon"}) ${esc(n.content)}`);
        }
        lines.push("");
      }
      files[`nodes/${q.id}.md`] = lines.join("\n");
    }

    return NextResponse.json({
      manifest: {
        scope,
        owner: user.email,
        nodeCount: data.qa.length,
        branchCount: byRoot.size,
        exportedAt: new Date().toISOString(),
      },
      files,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
