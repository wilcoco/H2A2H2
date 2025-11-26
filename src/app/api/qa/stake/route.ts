import { NextRequest, NextResponse } from "next/server";
import { withConn, ensureTables } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { z } from "zod";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const Body = z.object({
  rootId: z.string().min(1).optional(),
  qaId: z.string().min(1).optional(),
  amount: z.number().int().min(1).max(20),
  lockDays: z.number().int().optional().default(7),
});

export async function POST(req: NextRequest) {
  try {
    await ensureTables();

    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    const userId = user?.email ?? null;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const json = await req.json();
    const input = Body.parse(json);

    const allowedLocks = [3, 7, 14];
    const lockDays = allowedLocks.includes(input.lockDays) ? input.lockDays : 7;

    const { rootId: rootIdMaybe, qaId, amount } = input;

    const { rootId } = await withConn(async (c) => {
      if (rootIdMaybe) return { rootId: rootIdMaybe };
      if (!qaId) throw new Error("rootId or qaId required");
      const r = await c.query(
        `select coalesce(root_id, id) as rid from qa_entries where id = $1 limit 1`,
        [qaId]
      );
      if (!r.rowCount) throw new Error("QA not found");
      return { rootId: r.rows[0].rid as string };
    });

    const now = new Date();
    const lockUntil = new Date(now.getTime() + lockDays * 24 * 60 * 60 * 1000);

    const dailyLimit = 100;
    const perChainLimit = 20;

    type StakeResult = { id: string } | { error: string };
    const ok: StakeResult = await withConn(async (c) => {
      const r1 = await c.query(
        `select coalesce(sum(amount),0) as sum from stake_ledger where user_id = $1 and created_at >= date_trunc('day', now())`,
        [userId]
      );
      const todayUsed = Number(r1.rows[0].sum || 0);
      if (todayUsed + amount > dailyLimit) {
        return { error: `Daily staking limit exceeded (${dailyLimit})` } as StakeResult;
      }
      const r2 = await c.query(
        `select coalesce(sum(amount),0) as sum from stake_ledger where user_id = $1 and qa_root_id = $2 and created_at >= date_trunc('day', now())`,
        [userId, rootId]
      );
      const todayOnChain = Number(r2.rows[0].sum || 0);
      if (todayOnChain + amount > perChainLimit) {
        return { error: `Per-chain daily limit exceeded (${perChainLimit})` } as StakeResult;
      }

      const id = randomUUID();
      await c.query(
        `insert into stake_ledger (id, user_id, qa_id, qa_root_id, amount, lock_days, created_at, lock_until)
         values ($1,$2,$3,$4,$5,$6, now(), $7)`,
        [id, userId, qaId ?? null, rootId, amount, lockDays, lockUntil]
      );
      return { id } as StakeResult;
    });

    if ('error' in ok) return NextResponse.json({ error: ok.error }, { status: 400 });

    return NextResponse.json({ ok: true, id: ok.id, rootId, amount, lockDays, lockUntil });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
