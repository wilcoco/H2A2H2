"use client";

import { useEffect, useState } from "react";

type State = { enabled: boolean; provider?: string; label?: string; keyMasked?: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

// BYOK = "Bring Your Own Key". 사용자가 본인 OpenAI/Anthropic API 키를 등록하면
// 무료 quota·포인트와 별개로 본인 비용으로 호출 가능. 키는 AES-GCM 암호화 저장.
export default function BYOKModal({ open, onClose, onChanged }: Props) {
  const [state, setState] = useState<State | null>(null);
  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/user/byok", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (active) setState(j as State);
      } catch {}
    })();
    return () => { active = false; };
  }, [open]);

  if (!open) return null;

  async function save() {
    if (!apiKey.trim()) { setMsg("API 키를 입력하세요"); return; }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/user/byok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: apiKey.trim(), label: label.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || "저장 실패"); return; }
      setMsg("✓ 키 등록됨 — 이제 본인 키로 호출됩니다.");
      setApiKey("");
      setState({ enabled: true, provider: j.provider, label: j.label });
      onChanged?.();
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm("등록된 BYOK 키를 삭제할까요?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/user/byok", { method: "DELETE" });
      if (!r.ok) { setMsg("삭제 실패"); return; }
      setMsg("키가 삭제되었습니다.");
      setState({ enabled: false });
      onChanged?.();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onMouseDown={onClose}>
      <div className="bg-white text-gray-900 rounded-lg shadow-xl w-[min(520px,92vw)] p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="text-sm font-semibold">내 API 키 사용 (BYOK)</div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              본인의 OpenAI/Anthropic API 키를 등록하면 무료 호출이 끝나도 본인 비용으로 계속 쓸 수 있어요. 키는 AES-GCM으로 암호화되어 저장됩니다.
            </div>
          </div>
          <button className="text-xs px-2 py-1 rounded border" onClick={onClose}>닫기</button>
        </div>

        {state?.enabled && (
          <div className="text-[12px] mb-3 p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 flex items-center gap-2">
            <span>✓ 등록됨</span>
            <span className="text-emerald-700">{state.provider}{state.label ? ` · ${state.label}` : ""}</span>
            <button className="ml-auto text-[11px] px-2 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50" onClick={remove} disabled={busy}>삭제</button>
          </div>
        )}

        <div className="text-xs font-medium mb-1">{state?.enabled ? "키 교체" : "키 등록"}</div>
        <div className="flex flex-col gap-2">
          <div>
            <div className="text-[11px] text-gray-600 mb-0.5">provider</div>
            <select className="w-full border rounded px-2 py-1 text-sm" value={provider} onChange={(e) => setProvider(e.target.value as "openai" | "anthropic")}>
              <option value="openai">OpenAI (sk-...)</option>
              <option value="anthropic">Anthropic (sk-ant-...)</option>
            </select>
          </div>
          <div>
            <div className="text-[11px] text-gray-600 mb-0.5">API 키</div>
            <input type="password" className="w-full border rounded px-2 py-1 text-sm font-mono" placeholder={provider === "openai" ? "sk-..." : "sk-ant-..."} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
          <div>
            <div className="text-[11px] text-gray-600 mb-0.5">메모 (선택)</div>
            <input type="text" className="w-full border rounded px-2 py-1 text-sm" placeholder="예: 내 회사 키" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
        </div>

        {msg && <div className="text-[12px] mt-3 text-gray-700">{msg}</div>}

        <div className="flex items-center justify-end gap-2 mt-4">
          <button className="text-xs px-3 py-1.5 rounded border" onClick={onClose}>취소</button>
          <button className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50" onClick={save} disabled={busy || !apiKey.trim()}>{busy ? "검증·저장 중…" : "등록"}</button>
        </div>
      </div>
    </div>
  );
}
