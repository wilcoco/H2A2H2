// LLM 라우터: 사용자 quota 보고 free/point/byok 결정 + 호출 + 차감/적립.
//
// 정책:
//  1. BYOK 활성화되어 있고 사용자가 그걸 선호 (preferByok=true) → BYOK 호출, quota 영향 없음
//  2. 무료 quota 남아 있음 → 운영자 키 + free_used_today++
//  3. 포인트 잔액 >= 호출 비용 → 운영자 키 + point_balance--
//  4. 위 모두 실패 → 에러 ("quota_exhausted")
//
// 호출 비용은 단순화: 호출당 1 (모델별 차등은 후속 라운드).

import { withConn } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto/aes";
import { makeOpenAIAdapter } from "./openai";
import { makeAnthropicAdapter } from "./anthropic";
import type { ChatInput, ChatOutput, Tier, Provider, LlmAdapter } from "./types";

interface QuotaRow {
  user_email: string;
  free_used_today: number;
  free_quota_per_day: number;
  point_balance: number;
  byok_provider: string | null;
  byok_key_encrypted: string | null;
  byok_key_iv: string | null;
  byok_label: string | null;
  last_reset_day: string;
}

const DAILY_FREE_DEFAULT = Number(process.env.LLM_FREE_QUOTA_PER_DAY || 10);

async function ensureRow(email: string): Promise<QuotaRow> {
  return await withConn(async (c) => {
    // 일일 리셋: last_reset_day != 오늘이면 free_used_today 0으로 리셋
    await c.query(
      `insert into user_quota (user_email, free_quota_per_day) values ($1, $2)
       on conflict (user_email) do nothing`,
      [email, DAILY_FREE_DEFAULT]
    );
    await c.query(
      `update user_quota set free_used_today = 0, last_reset_day = current_date, updated_at = now()
        where user_email = $1 and last_reset_day < current_date`,
      [email]
    );
    const r = await c.query(`select * from user_quota where user_email = $1`, [email]);
    return r.rows[0] as QuotaRow;
  });
}

async function logCall(opts: { email: string | null; tier: Tier; provider: Provider; model: string; success: boolean; pt?: number; ct?: number; error?: string }) {
  try {
    await withConn(async (c) => {
      await c.query(
        `insert into llm_call_log (user_email, tier, provider, model, prompt_tokens, completion_tokens, success, error)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [opts.email, opts.tier, opts.provider, opts.model, opts.pt ?? null, opts.ct ?? null, opts.success, opts.error ?? null]
      );
    });
  } catch {}
}

export class QuotaExhausted extends Error {
  constructor(msg = "quota_exhausted") { super(msg); }
}

export interface RouteOptions {
  preferByok?: boolean;
  preferredProvider?: Provider;          // free/point tier에서 어떤 운영자 키를 쓸지 (openai|anthropic)
}

export interface RouteResult extends ChatOutput {
  tier: Tier;
  quotaAfter: { freeUsedToday: number; freeQuotaPerDay: number; pointBalance: number };
}

function operatorAdapter(provider: Provider): LlmAdapter | null {
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    return key ? makeOpenAIAdapter({ apiKey: key, label: "openai:operator" }) : null;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? makeAnthropicAdapter({ apiKey: key, label: "anthropic:operator" }) : null;
}

function byokAdapter(row: QuotaRow): LlmAdapter | null {
  if (!row.byok_provider || !row.byok_key_encrypted || !row.byok_key_iv) return null;
  const plain = decryptSecret(row.byok_key_encrypted, row.byok_key_iv);
  if (!plain) return null;
  if (row.byok_provider === "anthropic") return makeAnthropicAdapter({ apiKey: plain, label: `anthropic:byok` });
  return makeOpenAIAdapter({ apiKey: plain, label: `openai:byok` });
}

export async function routeAndCall(
  email: string | null,
  input: ChatInput,
  opts: RouteOptions = {}
): Promise<RouteResult> {
  // 비로그인 — 운영자 키 사용 (구버전 호환), quota 영향 없음. (향후 익명 quota 도입 가능)
  if (!email) {
    const provider = opts.preferredProvider || "openai";
    const adapter = operatorAdapter(provider) || operatorAdapter(provider === "openai" ? "anthropic" : "openai");
    if (!adapter) throw new Error("no_operator_key");
    const out = await adapter.call(input);
    void logCall({ email: null, tier: "free", provider: out.providerUsed, model: out.modelUsed, success: true, pt: out.promptTokens, ct: out.completionTokens });
    return { ...out, tier: "free", quotaAfter: { freeUsedToday: 0, freeQuotaPerDay: 0, pointBalance: 0 } };
  }

  const row = await ensureRow(email);

  // 1. BYOK 선호 + 유효한 BYOK 키
  if (opts.preferByok) {
    const adapter = byokAdapter(row);
    if (adapter) {
      try {
        const out = await adapter.call(input);
        void logCall({ email, tier: "byok", provider: out.providerUsed, model: out.modelUsed, success: true, pt: out.promptTokens, ct: out.completionTokens });
        return { ...out, tier: "byok", quotaAfter: { freeUsedToday: row.free_used_today, freeQuotaPerDay: row.free_quota_per_day, pointBalance: row.point_balance } };
      } catch (e) {
        void logCall({ email, tier: "byok", provider: row.byok_provider as Provider, model: "(byok)", success: false, error: e instanceof Error ? e.message : "err" });
        // BYOK 실패 시 무료/포인트로 폴백
      }
    }
  }

  // 2. 무료 quota
  const provider: Provider = opts.preferredProvider || "openai";
  if (row.free_used_today < row.free_quota_per_day) {
    const adapter = operatorAdapter(provider) || operatorAdapter(provider === "openai" ? "anthropic" : "openai");
    if (!adapter) throw new Error("no_operator_key");
    const out = await adapter.call(input);
    const next = await withConn(async (c) => {
      const r = await c.query(
        `update user_quota set free_used_today = free_used_today + 1, updated_at = now()
          where user_email = $1 returning free_used_today, free_quota_per_day, point_balance`,
        [email]
      );
      return r.rows[0];
    });
    void logCall({ email, tier: "free", provider: out.providerUsed, model: out.modelUsed, success: true, pt: out.promptTokens, ct: out.completionTokens });
    return { ...out, tier: "free", quotaAfter: { freeUsedToday: Number(next.free_used_today), freeQuotaPerDay: Number(next.free_quota_per_day), pointBalance: Number(next.point_balance) } };
  }

  // 3. 포인트 차감
  if (row.point_balance > 0) {
    const adapter = operatorAdapter(provider) || operatorAdapter(provider === "openai" ? "anthropic" : "openai");
    if (!adapter) throw new Error("no_operator_key");
    const out = await adapter.call(input);
    const next = await withConn(async (c) => {
      const r = await c.query(
        `update user_quota set point_balance = point_balance - 1, updated_at = now()
          where user_email = $1 returning free_used_today, free_quota_per_day, point_balance`,
        [email]
      );
      return r.rows[0];
    });
    void logCall({ email, tier: "point", provider: out.providerUsed, model: out.modelUsed, success: true, pt: out.promptTokens, ct: out.completionTokens });
    return { ...out, tier: "point", quotaAfter: { freeUsedToday: Number(next.free_used_today), freeQuotaPerDay: Number(next.free_quota_per_day), pointBalance: Number(next.point_balance) } };
  }

  throw new QuotaExhausted();
}

// 포인트 적립 (yield 또는 답이 +1 받았을 때 호출)
export async function addPoints(email: string, delta: number): Promise<number> {
  return await withConn(async (c) => {
    await c.query(
      `insert into user_quota (user_email) values ($1) on conflict do nothing`,
      [email]
    );
    const r = await c.query(
      `update user_quota set point_balance = greatest(0, point_balance + $2), updated_at = now()
        where user_email = $1 returning point_balance`,
      [email, delta]
    );
    return Number(r.rows[0]?.point_balance || 0);
  });
}

export async function getQuota(email: string): Promise<{
  freeUsedToday: number; freeQuotaPerDay: number; pointBalance: number; byokProvider: string | null; byokLabel: string | null;
}> {
  const row = await ensureRow(email);
  return {
    freeUsedToday: row.free_used_today,
    freeQuotaPerDay: row.free_quota_per_day,
    pointBalance: row.point_balance,
    byokProvider: row.byok_provider,
    byokLabel: row.byok_label,
  };
}
