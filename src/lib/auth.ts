import { SignJWT, jwtVerify } from "jose";

const encoder = new TextEncoder();
function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "dev-secret";
  return encoder.encode(secret);
}

export type SessionUser = { email: string; name?: string };

export async function signSession(user: SessionUser, exp: string = "7d"): Promise<string> {
  return await new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!email) return null;
    const name = typeof payload.name === "string" ? payload.name : undefined;
    return { email, name };
  } catch {
    return null;
  }
}
