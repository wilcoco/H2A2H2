import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { z } from "zod";
import { shouldAutoTransition, canChangeRule, type GovernanceState, type Phase } from "@/lib/nightwish/governance";

export const runtime = "nodejs";

interface GovRow {
  phase: Phase;
  admin_email: string | null;
  decentralize_at: number | string;
  council_quorum_pct: number | string;
  participant_count: number | string;
}

async function loadState(): Promise<GovernanceState & { councilSize: number; admin: string | null }> {
  return await withConn(async (c) => {
    const g = await c.query(`select * from governance_state where id = 1`);
    const row = g.rows[0] as GovRow | undefined;
    const cc = await c.query(`select count(*)::int as n from governance_council`);
    const councilSize = Number(cc.rows[0]?.n || 0);
    const phase = (row?.phase as Phase) || "bootstrap";
    return {
      phase,
      adminEmail: row?.admin_email ?? null,
      admin: row?.admin_email ?? null,
      decentralizeAt: Number(row?.decentralize_at ?? 100),
      councilQuorumPct: Number(row?.council_quorum_pct ?? 50),
      participantCount: Number(row?.participant_count ?? 0),
      councilSize,
    };
  });
}

export async function GET() {
  try {
    await ensureTables();
    const s = await loadState();
    return NextResponse.json({
      phase: s.phase,
      adminEmail: s.adminEmail,
      decentralizeAt: s.decentralizeAt,
      councilQuorumPct: s.councilQuorumPct,
      participantCount: s.participantCount,
      councilSize: s.councilSize,
      remainingToDecentralize: Math.max(0, s.decentralizeAt - s.participantCount),
    });
  } catch {
    return NextResponse.json({ phase: "bootstrap", participantCount: 0, decentralizeAt: 100, councilQuorumPct: 50, councilSize: 0, remainingToDecentralize: 100, adminEmail: null });
  }
}

// POST: 참여자 등록 (자동 분권 전환 평가). 동일 이메일은 idempotent.
const Body = z.object({
  action: z.enum(["register", "seat_council", "remove_council", "set_rule"]).default("register"),
  email: z.string().email().optional(),
  member: z.string().email().optional(),
  key: z.string().optional(),
  value: z.number().optional(),
  approvals: z.array(z.string().email()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const input = Body.parse(await req.json().catch(() => ({})));
    const before = await loadState();

    if (input.action === "register") {
      const email = (input.email || user.email).trim();
      const after = await withConn(async (c) => {
        // qa_feedback / qa_entries / stake_ledger 사용자에 자동으로 신호. 여기는 명시 등록.
        // 참여자 카운트 단순 추정: distinct user_id from (qa_entries, qa_feedback, stake_ledger)
        const r = await c.query(
          `with all_users as (
             select created_by as u from qa_entries where created_by is not null
             union select user_id from qa_feedback
             union select user_id from stake_ledger
           )
           select count(*)::int as n from (select distinct u from all_users where u is not null) t`
        );
        const n = Number(r.rows[0]?.n || 0);
        // include the newly registered user if not yet present
        const includeNew = await c.query(`select 1 from qa_entries where created_by = $1 limit 1`, [email]);
        const final = includeNew.rowCount ? n : n + 1;
        await c.query(`update governance_state set participant_count = $1, updated_at = now() where id = 1`, [final]);
        return final;
      });

      const s2: GovernanceState = { ...before, participantCount: after };
      if (shouldAutoTransition(s2)) {
        await withConn(async (c) => {
          await c.query(`update governance_state set phase = 'decentralized', updated_at = now() where id = 1`);
          await c.query(
            `insert into governance_log (actor, kind, detail) values ($1, 'auto_decentralize', $2)`,
            [user.email, `participants reached ${after}/${before.decentralizeAt}; rule-change power -> council`]
          );
        });
      }
      const state = await loadState();
      return NextResponse.json({ ok: true, ...state });
    }

    if (input.action === "seat_council") {
      const member = (input.member || "").trim();
      if (!member) return NextResponse.json({ error: "member required" }, { status: 400 });
      const check = canChangeRule(before, { byEmail: user.email, approvals: input.approvals ?? [] }, before.councilSize);
      if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 403 });
      await withConn(async (c) => {
        await c.query(`insert into governance_council (email) values ($1) on conflict (email) do nothing`, [member]);
        await c.query(`insert into governance_log (actor, kind, detail) values ($1, 'seat_council', $2)`, [user.email, member]);
      });
      return NextResponse.json({ ok: true, ...(await loadState()) });
    }

    if (input.action === "remove_council") {
      const member = (input.member || "").trim();
      const check = canChangeRule(before, { byEmail: user.email, approvals: input.approvals ?? [] }, before.councilSize);
      if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 403 });
      await withConn(async (c) => {
        await c.query(`delete from governance_council where email = $1`, [member]);
        await c.query(`insert into governance_log (actor, kind, detail) values ($1, 'remove_council', $2)`, [user.email, member]);
      });
      return NextResponse.json({ ok: true, ...(await loadState()) });
    }

    if (input.action === "set_rule") {
      if (!input.key || input.value === undefined) return NextResponse.json({ error: "key+value required" }, { status: 400 });
      const check = canChangeRule(before, { byEmail: user.email, approvals: input.approvals ?? [] }, before.councilSize);
      if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 403 });
      await withConn(async (c) => {
        if (input.key === "decentralizeAt") {
          await c.query(`update governance_state set decentralize_at = $1, updated_at = now() where id = 1`, [Math.round(input.value!)]);
        } else if (input.key === "councilQuorumPct") {
          await c.query(`update governance_state set council_quorum_pct = $1, updated_at = now() where id = 1`, [Math.round(input.value!)]);
        } else {
          throw new Error(`unsupported rule key: ${input.key}`);
        }
        await c.query(`insert into governance_log (actor, kind, detail) values ($1, 'set_rule', $2)`, [user.email, `${input.key}=${input.value}`]);
      });
      return NextResponse.json({ ok: true, ...(await loadState()) });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
