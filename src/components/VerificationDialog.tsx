"use client";

import { useState } from "react";

type Suggestion = {
  metric: string;
  baseline: number;
  observed: number;
  unit?: string;
  direction?: "higher_better" | "lower_better";
  minRelImprovement?: number;
  rationale?: string;
};

type Props = {
  qaId: string;
  question?: string;
  answer?: string;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

export default function VerificationDialog({ qaId, question, answer, open, onClose, onSaved }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [draft, setDraft] = useState<Suggestion>({ metric: "", baseline: 0, observed: 0, direction: "higher_better", minRelImprovement: 0.2, unit: "" });
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  if (!open) return null;

  async function getAiDraft() {
    if (!question || !answer) { setMsg("질문/답변이 있어야 AI 초안을 받을 수 있어요"); return; }
    setSuggesting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/qa/verify/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer }),
      });
      const j = await r.json().catch(() => ({}));
      const list = Array.isArray(j?.suggestions) ? j.suggestions : [];
      setSuggestions(list);
      if (list.length === 0) setMsg("AI가 외부 검증 가능한 메트릭을 찾지 못했습니다. 수동으로 입력해 주세요.");
      else { setDraft(list[0]); setMsg(null); }
    } catch (e) {
      setMsg("AI 초안 요청 실패");
    } finally {
      setSuggesting(false);
    }
  }

  async function save() {
    if (!draft.metric.trim()) { setMsg("metric 이름을 입력하세요"); return; }
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/qa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qaId,
          metric: draft.metric.trim(),
          baseline: Number(draft.baseline),
          observed: Number(draft.observed),
          unit: draft.unit || undefined,
          direction: draft.direction || "higher_better",
          minRelImprovement: draft.minRelImprovement ?? 0.2,
          sourceUrl: sourceUrl.trim() || undefined,
          sourceNote: sourceNote.trim() || undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || "등록 실패"); return; }
      setMsg(j?.passes ? "✓ 등록 — 검증 통과" : "✗ 등록 — 임계 미달");
      onSaved?.();
      setTimeout(() => { onClose(); }, 700);
    } catch {
      setMsg("등록 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onMouseDown={onClose}>
      <div className="bg-white text-gray-900 rounded shadow-lg w-[min(680px,92vw)] max-h-[88vh] overflow-auto p-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="text-sm font-semibold">외부 현실 닻 — 검증 메트릭 등록</div>
            <div className="text-[11px] text-gray-500 mt-0.5">측정 가능한 결과(수율, 불량률, 지연, 비용 등)만. 동의·만족도는 닻이 아닙니다.</div>
          </div>
          <button className="text-xs px-2 py-1 rounded border" onClick={onClose}>닫기</button>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button
            className="text-xs px-3 py-1.5 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
            onClick={getAiDraft}
            disabled={suggesting || !question || !answer}
          >{suggesting ? "AI 초안 작성 중…" : "AI 초안 받기"}</button>
          <span className="text-[11px] text-gray-500">또는 직접 입력</span>
        </div>

        {suggestions.length > 0 && (
          <div className="mb-3">
            <div className="text-[11px] text-gray-500 mb-1">AI 초안 ({suggestions.length}개) — 선택하면 편집창에 채워짐</div>
            <div className="flex flex-wrap gap-1">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  className={`text-[11px] px-2 py-1 rounded border ${draft.metric === s.metric ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:bg-gray-50"}`}
                  onClick={() => setDraft(s)}
                >{s.metric} ({s.baseline}{s.unit || ""}→{s.observed}{s.unit || ""})</button>
              ))}
            </div>
            {draft.rationale && <div className="text-[11px] text-gray-500 mt-1">{draft.rationale}</div>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="메트릭 (metric)" value={draft.metric} onChange={(v) => setDraft({ ...draft, metric: v })} placeholder="예: defect_rate" />
          <Field label="단위 (unit)" value={draft.unit || ""} onChange={(v) => setDraft({ ...draft, unit: v })} placeholder="예: %, ms, MPa" />
          <NumField label="기준값 (baseline)" value={draft.baseline} onChange={(v) => setDraft({ ...draft, baseline: v })} />
          <NumField label="관측값 (observed)" value={draft.observed} onChange={(v) => setDraft({ ...draft, observed: v })} />
          <div>
            <div className="text-[11px] text-gray-600 mb-0.5">좋은 방향</div>
            <select
              className="w-full border rounded px-2 py-1 text-sm"
              value={draft.direction || "higher_better"}
              onChange={(e) => setDraft({ ...draft, direction: e.target.value === "lower_better" ? "lower_better" : "higher_better" })}
            >
              <option value="higher_better">크면 좋음 (수율, 강도)</option>
              <option value="lower_better">작으면 좋음 (불량, 지연)</option>
            </select>
          </div>
          <NumField label="최소 상대개선 (0~1)" value={draft.minRelImprovement ?? 0.2} step={0.05} onChange={(v) => setDraft({ ...draft, minRelImprovement: v })} />
          <Field label="출처 URL" value={sourceUrl} onChange={setSourceUrl} placeholder="https://..." />
          <Field label="출처 메모" value={sourceNote} onChange={setSourceNote} placeholder="공장 라인 A, 2026-05-12 측정" />
        </div>

        {msg && <div className="text-[12px] mt-3 text-gray-700">{msg}</div>}

        <div className="flex items-center justify-end gap-2 mt-4">
          <button className="text-xs px-3 py-1.5 rounded border" onClick={onClose}>취소</button>
          <button
            className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            onClick={save}
            disabled={saving || !draft.metric.trim()}
          >{saving ? "등록 중…" : "검증 등록"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <div className="text-[11px] text-gray-600 mb-0.5">{label}</div>
      <input
        className="w-full border rounded px-2 py-1 text-sm"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <div className="text-[11px] text-gray-600 mb-0.5">{label}</div>
      <input
        type="number"
        step={step ?? "any"}
        className="w-full border rounded px-2 py-1 text-sm"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
