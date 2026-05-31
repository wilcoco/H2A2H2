// 기여 이벤트로 stake_ledger의 last_contribution_at 리셋.
// economy.distributeDividend의 시간붕괴 메커니즘과 짝맞춤:
// "갱신 안 된 지분의 수익률이 0으로 수렴" — 자본만의 자기증식 차단.

import { withConn } from "@/lib/db";

export async function touchContribution(userId: string, qaIdOrRoot: string): Promise<void> {
  if (!userId || !qaIdOrRoot) return;
  await withConn(async (c) => {
    // 같은 root_id 가지에 내가 건 모든 라이브 stake의 last_contribution_at = now()
    await c.query(
      `update stake_ledger
          set last_contribution_at = now()
        where user_id = $1
          and is_reclaimed = false
          and qa_root_id = coalesce(
                (select coalesce(root_id, id) from qa_entries where id = $2 limit 1),
                $2
              )`,
      [userId, qaIdOrRoot]
    );
  });
}
