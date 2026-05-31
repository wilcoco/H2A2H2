import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { getQuota } from "@/lib/llm/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const token = req.cookies.get("session")?.value;
    const user = token ? await verifySession(token) : null;
    if (!user?.email) return NextResponse.json({ signedIn: false });
    const q = await getQuota(user.email);
    return NextResponse.json({ signedIn: true, ...q });
  } catch {
    return NextResponse.json({ signedIn: false });
  }
}
