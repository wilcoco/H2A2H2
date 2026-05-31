"use client";

import { useState } from "react";

type Props = {
  signedIn: boolean;
  scope?: "mine" | "all";
};

// Karpathy 식 vault export — index.md + log.md + nodes/<id>.md 묶음.
// 단일 .md 파일로 다운로드 (간단). 향후 zip 전환 시 JSZip 추가.
export default function VaultExportButton({ signedIn, scope = "mine" }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    if (!signedIn) { setMsg("로그인 필요"); return; }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/vault/export?scope=${scope}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || "export 실패"); return; }
      const files: Record<string, string> = j.files || {};
      const manifest = j.manifest || {};
      // 단일 마크다운 파일로 합쳐 다운로드 (각 파일을 `--- FILE: <path> ---` 구분)
      const ordered = ["index.md", "log.md", ...Object.keys(files).filter((p) => p.startsWith("nodes/")).sort()];
      const blob = new Blob(
        ordered.map((p) => `\n\n<!-- ===== FILE: ${p} ===== -->\n\n${files[p] || ""}\n`),
        { type: "text/markdown;charset=utf-8" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vault_${scope}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg(`다운로드 — ${manifest.nodeCount || 0} 노드 / ${manifest.branchCount || 0} 가지`);
    } catch {
      setMsg("export 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        onClick={go}
        disabled={busy || !signedIn}
        title="내 vault를 index.md + log.md + 노드별 md로 export"
      >{busy ? "export 중…" : "📥 export"}</button>
      {msg && <span className="text-[10px] text-gray-500">{msg}</span>}
    </span>
  );
}
