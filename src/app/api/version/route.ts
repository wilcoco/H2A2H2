import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function getRepo() {
  const owner = process.env.GIT_REPO_OWNER || process.env.VERCEL_GIT_REPO_OWNER || "wilcoco";
  const repo = process.env.GIT_REPO_NAME || process.env.VERCEL_GIT_REPO_SLUG || "H2A2H2";
  const branch = process.env.GIT_REPO_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || "main";
  return { owner, repo, branch };
}

export async function GET(_req: NextRequest) {
  try {
    const { owner, repo, branch } = getRepo();
    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;
    const headers: Record<string, string> = { "Accept": "application/vnd.github+json" };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const r = await fetch(url, { headers, cache: "no-store" });
    if (!r.ok) {
      return NextResponse.json({ title: `GitHub status ${r.status}` }, { status: 200 });
    }
    const j = await r.json();
    const sha: string | undefined = j?.sha ? String(j.sha) : undefined;
    const msg: string = j?.commit?.message ? String(j.commit.message) : "";
    const [titleLine, ...rest] = msg.split("\n");
    const title = (titleLine || "").trim();
    const message = rest.join("\n").trim();
    return NextResponse.json({ sha, title, message });
  } catch {
    return NextResponse.json({ title: "Unknown version" });
  }
}
