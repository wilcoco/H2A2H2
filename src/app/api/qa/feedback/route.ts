import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const qaId: string = (body?.qaId ?? "").toString();
    const voteNum = Number(body?.vote);
    const vote: 1 | -1 | 0 = voteNum === 1 ? 1 : voteNum === -1 ? -1 : 0;
    const comment: string | null = body?.comment ? String(body.comment) : null;
    if (!qaId) return NextResponse.json({ error: "Missing qaId" }, { status: 400 });
    if (vote === 0 && !comment) return NextResponse.json({ error: "Missing vote or comment" }, { status: 400 });

    await withConn(async (c) => {
      if (vote === 0) {
        // Only comment -> insert or update comment with neutral vote 0
        await c.query(
          `insert into qa_feedback (qa_id, user_id, vote, comment)
           values ($1,$2,0,$3)
           on conflict (qa_id, user_id) do update set comment = excluded.comment`,
          [qaId, user.email, comment]
        );
      } else {
        await c.query(
          `insert into qa_feedback (qa_id, user_id, vote, comment)
           values ($1,$2,$3,$4)
           on conflict (qa_id, user_id) do update set vote = excluded.vote, comment = excluded.comment`,
          [qaId, user.email, vote, comment]
        );
      }
    });

    const agg = await withConn(async (c) => {
      const r = await c.query(
        `select 
           coalesce(sum(case when vote = 1 then 1 else 0 end),0) as helpful,
           coalesce(sum(case when vote = -1 then 1 else 0 end),0) as unhelpful,
           max(case when user_id = $2 then vote else null end) as my_vote
         from qa_feedback where qa_id = $1`,
        [qaId, user.email]
      );
      const row = r.rows?.[0] ?? { helpful: 0, unhelpful: 0, my_vote: 0 };
      return { helpful: Number(row.helpful || 0), unhelpful: Number(row.unhelpful || 0), myVote: row.my_vote === 1 ? 1 : row.my_vote === -1 ? -1 : 0 };
    });

    return NextResponse.json(agg);
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
