import { NextRequest, NextResponse } from "next/server";
import { ensureTables, withConn } from "@/lib/db";
import { verifySession } from "@/lib/auth";

export const runtime = "nodejs";

// Canonical core 8 types (export for client reuse if needed)
export const CORE_TYPES = [
  "narrows",
  "elaborates",
  "clarifies",
  "prerequisite",
  "precedes",
  "supports",
  "refutes",
  "alternative",
] as const;
const ALLOWED_TYPES = new Set<string>(CORE_TYPES as unknown as string[]);

// Backward-compat aliases
function normalizeType(t: string): string | null {
  const s = (t || "").toLowerCase().trim();
  if (!s) return null;
  if (ALLOWED_TYPES.has(s)) return s;
  switch (s) {
    case "follows_from":
      return "precedes";
    case "refines":
      return "elaborates"; // server-side neutral mapping
    case "depends_on":
      return "prerequisite";
    // common synonyms
    case "is_narrower_than":
    case "subset_of":
      return "narrows";
    case "is_broader_than":
    case "superset_of":
      return "narrows"; // store as narrows in canonical direction by UI choices
    case "clarify":
    case "disambiguates":
      return "clarifies";
    case "before":
    case "precedes_in_sequence":
      return "precedes";
    case "supports_with_evidence":
    case "evidences":
      return "supports";
    case "contradicts":
    case "opposes":
      return "refutes";
    default:
      return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    // Optional API key for scripted calls
    const apiKeyHeader = req.headers.get("x-api-key");
    const serverKey = process.env.RELATION_API_KEY || process.env.API_KEY || "";
    const viaApiKey = !!apiKeyHeader && !!serverKey && apiKeyHeader === serverKey;

    const body = await req.json().catch(() => ({}));
    const sourceId: string = (body?.sourceId ?? "").toString();
    const targetId: string = (body?.targetId ?? "").toString();
    const rawType: string = (body?.type ?? "").toString();
    const type = normalizeType(rawType);
    const weightNum = Number(body?.weight ?? 1);
    const weight = Number.isFinite(weightNum) ? Math.max(1, Math.min(9, Math.trunc(weightNum))) : 1;

    if (!sourceId || !targetId || !type) return NextResponse.json({ error: "Missing or invalid params" }, { status: 400 });
    if (sourceId === targetId) return NextResponse.json({ error: "source==target" }, { status: 400 });
    if (!ALLOWED_TYPES.has(type)) return NextResponse.json({ error: "Invalid type" }, { status: 400 });

    const ok = await withConn(async (c) => {
      const a = await c.query(`select 1 from qa_entries where id = $1`, [sourceId]);
      const b = await c.query(`select 1 from qa_entries where id = $1`, [targetId]);
      if (!a.rows?.[0] || !b.rows?.[0]) return false;
      await c.query(
        `insert into qa_relations (source_id, target_id, type, weight, created_by)
         values ($1,$2,$3,$4,$5)
         on conflict (source_id, target_id, type)
         do update set weight = excluded.weight, created_by = excluded.created_by, created_at = now()`,
        [sourceId, targetId, type, weight, user?.email ?? (viaApiKey ? "api-key" : null)]
      );
      return true;
    });
    if (!ok) return NextResponse.json({ error: "QA not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables();

    const body = await req.json().catch(() => ({}));
    const sourceId: string = (body?.sourceId ?? "").toString();
    const targetId: string = (body?.targetId ?? "").toString();
    const rawType: string = (body?.type ?? "").toString();
    const type = normalizeType(rawType);
    if (!sourceId || !targetId || !type) return NextResponse.json({ error: "Missing or invalid params" }, { status: 400 });

    // Also cover legacy aliases in deletion for safety
    const legacy = (t: string): string | null => {
      switch (t) {
        case "precedes": return "follows_from";
        case "elaborates": return "refines";
        case "prerequisite": return "depends_on";
        default: return null;
      }
    };
    const legacyType = legacy(type);
    await withConn(async (c) => {
      if (legacyType) {
        await c.query(`delete from qa_relations where source_id = $1 and target_id = $2 and type in ($3, $4)`, [sourceId, targetId, type, legacyType]);
      } else {
        await c.query(`delete from qa_relations where source_id = $1 and target_id = $2 and type = $3`, [sourceId, targetId, type]);
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
