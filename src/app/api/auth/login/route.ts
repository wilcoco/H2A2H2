import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signSession } from "@/lib/auth";

const Body = z.object({ email: z.string().email(), name: z.string().min(1).optional() });

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const input = Body.parse(json);
    const token = await signSession({ email: input.email, name: input.name });
    const isProd = process.env.NODE_ENV === "production";
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: "session",
      value: token,
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
