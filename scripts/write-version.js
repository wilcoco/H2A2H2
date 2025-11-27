#!/usr/bin/env node
const { execSync } = require('node:child_process');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join, dirname } = require('node:path');

function getEnvCommit() {
  const msgRaw = String(
    process.env.VERSION_TITLE ||
      process.env.NEXT_PUBLIC_VERSION_TITLE ||
      process.env.VERCEL_GIT_COMMIT_MESSAGE ||
      process.env.RAILWAY_GIT_COMMIT_MESSAGE ||
      ''
  );
  const shaRaw = String(
    process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA ||
      process.env.SOURCE_VERSION ||
      ''
  );
  const branchRaw = String(
    process.env.GIT_REPO_BRANCH ||
      process.env.VERCEL_GIT_COMMIT_REF ||
      process.env.RAILWAY_GIT_BRANCH ||
      ''
  );
  const msg = msgRaw.trim();
  const sha = shaRaw.trim();
  const branch = branchRaw.trim();
  if (!msg && !sha) return null;
  const [titleLine, ...rest] = msg.split('\n');
  const title = (titleLine || '').trim();
  const message = rest.join('\n').trim();
  return { title, message, sha: sha || undefined, branch: branch || undefined };
}

function getGitCommit() {
  try {
    const sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const title = execSync('git log -1 --pretty=%s', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    let message = '';
    try {
      message = execSync('git log -1 --pretty=%b', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {}
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (title || sha) return { title, message, sha, branch };
  } catch {}
  return null;
}

function main() {
  const envData = getEnvCommit();
  const gitData = envData || getGitCommit();
  const data = gitData || { title: 'Unknown version', message: '', sha: undefined, branch: undefined };
  const out = {
    sha: data.sha,
    title: data.title,
    message: data.message,
    branch: data.branch,
    builtAt: new Date().toISOString(),
  };
  const file = join(process.cwd(), 'public', 'version.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('[version] wrote', file, '→', `${out.title}${out.sha ? ' (' + out.sha.slice(0, 7) + ')' : ''}`);
}

main();
