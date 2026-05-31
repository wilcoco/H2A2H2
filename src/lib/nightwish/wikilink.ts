// [[page-id|surface]] 또는 [[page-id]] 패턴 파싱 → 정규화된 링크 객체.

export interface WikiLink {
  targetPageId: string;
  surfaceText: string | null;
}

const RE = /\[\[(org_[a-z0-9]+)(?:\|([^\]]+))?\]\]/g;

export function parseWikilinks(body: string): WikiLink[] {
  if (!body) return [];
  const out: WikiLink[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = RE.exec(body)) !== null) {
    const id = m[1];
    const surface = m[2]?.trim() || null;
    const key = `${id}|${surface || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ targetPageId: id, surfaceText: surface });
  }
  return out;
}
