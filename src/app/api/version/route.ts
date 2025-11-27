import { NextRequest, NextResponse } from "next/server";
import { execSync } from "node:child_process";

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
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    // 1) Primary: commits/{branch}
    const primaryUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;
    let res = await fetch(primaryUrl, { headers, cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      const sha: string | undefined = j?.sha ? String(j.sha) : undefined;
      const msg: string = j?.commit?.message ? String(j.commit.message) : "";
      const [titleLine, ...rest] = msg.split("\n");
      const title = (titleLine || "").trim();
      const message = rest.join("\n").trim();
      return NextResponse.json({ sha, title, message });
    }

    // 2) Fallback: commits?sha=branch&per_page=1
    const listUrl = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`;
    res = await fetch(listUrl, { headers, cache: "no-store" });
    if (res.ok) {
      const arr: any[] = await res.json();
      const first = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
      if (first) {
        const sha: string | undefined = first?.sha ? String(first.sha) : undefined;
        const msg: string = first?.commit?.message ? String(first.commit.message) : "";
        const [titleLine, ...rest] = msg.split("\n");
        const title = (titleLine || "").trim();
        const message = rest.join("\n").trim();
        return NextResponse.json({ sha, title, message });
      }
    }

    // 3) Local git fallback
    try {
      const sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      const title = execSync("git log -1 --pretty=%s", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      let message = "";
      try {
        message = execSync("git log -1 --pretty=%b", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      } catch {}
      if (title || sha) return NextResponse.json({ sha, title, message });
    } catch {}

    return NextResponse.json({ title: "Unknown version" });
  } catch {
    return NextResponse.json({ title: "Unknown version" });
  }
}
