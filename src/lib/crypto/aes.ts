// BYOK 키 등 민감한 비밀의 AES-GCM 암호화/복호화.
// 마스터 키는 AUTH_SECRET 또는 BYOK_MASTER_KEY 환경변수에서 SHA-256 derive.

import crypto from "crypto";

function getMasterKey(): Buffer {
  const src = process.env.BYOK_MASTER_KEY || process.env.AUTH_SECRET || "dev-master-not-for-prod";
  return crypto.createHash("sha256").update(src).digest();
}

export function encryptSecret(plain: string): { ct: string; iv: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // ct = encrypted || tag (auth tag suffixed)
  const ct = Buffer.concat([encrypted, tag]).toString("base64");
  return { ct, iv: iv.toString("base64") };
}

export function decryptSecret(ct: string, iv: string): string | null {
  try {
    const ivBuf = Buffer.from(iv, "base64");
    const all = Buffer.from(ct, "base64");
    if (all.length < 16) return null;
    const tag = all.subarray(all.length - 16);
    const data = all.subarray(0, all.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getMasterKey(), ivBuf);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return plain;
  } catch {
    return null;
  }
}

// 응답에 키를 노출할 때 사용 (마지막 4글자만)
export function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 8) return "•".repeat(k.length);
  return k.slice(0, 3) + "••••" + k.slice(-4);
}
