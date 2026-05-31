import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { encryptSecret, maskKey } from "@/lib/crypto/aes";
import { z } from "zod";
import { makeOpenAIAdapter } from "@/lib/llm/openai";
import { makeAnthropicAdapter } from "@/lib/llm/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  provider: z.enum(["openai", "anthropic"]),
  apiKey: z.string().min(10),
  label: z.string().max(80).optional(),
});

async function pingKey(provider: "openai" | "anthropic", key: string): Promise<boolean> {
  try {
    if (provider === "openai") {
      // OpenAI Responses API에 가장 가벼운 호출 (max_output_tokens 4)
      const adapter = makeOpenAIAdapter({ apiKey: key, model: "gpt-4o-mini" });
      const out = await adapter.call({ system: "Reply with one word.", user: "ping", maxTokens: 8 });
      return Boolean(out.text);
    } else {
      const adapter = makeAnthropicAdapter({ apiKey: key, model: "claude-3-5-haiku-latest" });
      const out = await adapter.call({ system: "Reply with one word.", user: "ping", maxTokens: 8 });
      return Boolean(out.text);
    }
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ enabled: false });
    const row = await withConn(async (c) => {
      const r = await c.query(
        `select byok_provider, byok_label, byok_key_encrypted from user_quota where user_email = $1`,
        [user.email]
      );
      return r.rows[0] as { byok_provider: string | null; byok_label: string | null; byok_key_encrypted: string | null } | undefined;
    });
    if (!row?.byok_provider || !row.byok_key_encrypted) {
      return NextResponse.json({ enabled: false });
    }
    return NextResponse.json({
      enabled: true,
      provider: row.byok_provider,
      label: row.byok_label || "",
      keyMasked: maskKey("****" + row.byok_key_encrypted.slice(0, 6)),
    });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const input = Body.parse(await req.json());
    const ok = await pingKey(input.provider, input.apiKey);
    if (!ok) return NextResponse.json({ error: "키 검증 실패 — provider 응답 없음" }, { status: 400 });

    const enc = encryptSecret(input.apiKey);
    await withConn(async (c) => {
      await c.query(
        `insert into user_quota (user_email, byok_provider, byok_key_encrypted, byok_key_iv, byok_label, updated_at)
           values ($1, $2, $3, $4, $5, now())
         on conflict (user_email) do update
           set byok_provider = excluded.byok_provider,
               byok_key_encrypted = excluded.byok_key_encrypted,
               byok_key_iv = excluded.byok_key_iv,
               byok_label = excluded.byok_label,
               updated_at = now()`,
        [user.email, input.provider, enc.ct, enc.iv, input.label || null]
      );
    });

    return NextResponse.json({ ok: true, provider: input.provider, label: input.label || null });
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
    await withConn(async (c) => {
      await c.query(
        `update user_quota set byok_provider = null, byok_key_encrypted = null, byok_key_iv = null, byok_label = null, updated_at = now() where user_email = $1`,
        [user.email]
      );
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
