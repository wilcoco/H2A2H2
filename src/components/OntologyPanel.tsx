"use client";

import { useEffect, useMemo, useState } from "react";

type VerifCand = { metric: string; direction?: "higher_better" | "lower_better"; rationale?: string };

type OutgoingLink = { targetPageId: string; targetTitle: string; surfaceText: string | null };

type OrganizedItem = {
  id: string;
  rootId: string;
  title: string;
  summaryLine: string;
  body?: string;
  keywords: string[];
  category?: string | null;
  verificationCandidates?: VerifCand[] | null;
  organizedBy: string;
  organizedAt: string;
  updatedAt: string;
  isMine: boolean;
  forkedFrom?: string | null;
  outgoingLinks?: OutgoingLink[];
};

type BacklinkItem = {
  sourceId: string;
  sourceTitle: string;
  sourceSummary: string;
  sourceOwner: string;
  surfaceText: string | null;
  createdAt: string;
};

type DraftMeta = {
  tier?: "free" | "point" | "byok";
  modelUsed?: string;
  quotaAfter?: { freeUsedToday: number; freeQuotaPerDay: number; pointBalance: number };
};

type Draft = {
  title: string;
  summary_line: string;
  body: string;
  keywords: string[];
  category?: string;
  verification_candidates?: VerifCand[];
};

type Props = {
  rootId?: string;             // 정리할 가지의 root id
  signedIn: boolean;
  preferByok?: boolean;
  onAfterSave?: () => void;
};

// "정리하기" 패널 — 이 대화 가지를 다음 사람을 위해 정리해 공유.
// 1) AI가 가지 전체를 보고 초안 생성 (title/summary/body/keywords/category/검증후보)
// 2) 사용자가 인라인 첨삭
// 3) "정리해서 공유하기" → organized_pages 저장 → 좌측 검색 우선 노출.
export default function OntologyPanel({ rootId, signedIn, preferByok = false, onAfterSave }: Props) {
  const [items, setItems] = useState<OrganizedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftMeta, setDraftMeta] = useState<DraftMeta | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [kwInput, setKwInput] = useState("");
  const [tick, setTick] = useState(0);
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);

  useEffect(() => {
    if (!rootId) { setItems([]); setDraft(null); return; }
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/qa/organize?rootId=${encodeURIComponent(rootId)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (active) {
          const arr = Array.isArray(j?.items) ? j.items as OrganizedItem[] : [];
          setItems(arr);
          // 본인 정리가 있으면 그걸 draft로 띄움 (편집 모드)
          const mine = arr.find((it) => it.isMine);
          if (mine) {
            setDraft({
              title: mine.title,
              summary_line: mine.summaryLine,
              body: mine.body || "",
              keywords: mine.keywords || [],
              category: mine.category || "",
              verification_candidates: mine.verificationCandidates || [],
            });
          } else {
            setDraft(null);
          }
        }
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [rootId, tick]);

  const myItem = useMemo(() => items.find((it) => it.isMine) || null, [items]);
  const others = useMemo(() => items.filter((it) => !it.isMine), [items]);

  // 내 페이지를 참조하는 다른 페이지들 (backlinks)
  useEffect(() => {
    if (!myItem) { setBacklinks([]); return; }
    let active = true;
    (async () => {
      try {
        const r = await fetch(`/api/qa/organize/backlinks?id=${encodeURIComponent(myItem.id)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (active) setBacklinks(Array.isArray(j?.items) ? j.items : []);
      } catch {}
    })();
    return () => { active = false; };
  }, [myItem?.id, tick]);

  async function aiDraft() {
    if (!rootId) return;
    setBusy("draft");
    setMsg(null);
    try {
      const r = await fetch("/api/qa/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootId, draftOnly: true, preferByok }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) { setMsg(j?.message || "오늘의 무료 호출이 끝났어요"); return; }
      if (!r.ok) { setMsg(j?.error || "AI 정리 실패"); return; }
      setDraft({
        title: j.draft.title,
        summary_line: j.draft.summary_line,
        body: j.draft.body || "",
        keywords: j.draft.keywords || [],
        category: j.draft.category || "",
        verification_candidates: j.draft.verification_candidates || [],
      });
      setDraftMeta(j.meta || null);
      setMsg("AI 초안이 채워졌어요. 자유롭게 수정 후 저장하세요.");
    } catch { setMsg("AI 정리 실패"); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!rootId || !draft) return;
    if (!draft.title.trim() || !draft.summary_line.trim()) { setMsg("제목과 한 줄 요약은 필수"); return; }
    setBusy("save");
    setMsg(null);
    try {
      const r = await fetch("/api/qa/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootId,
          draftOnly: false,
          ...draft,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || "저장 실패"); return; }
      setMsg(j.inserted ? "✓ 저장 완료 — 검색에 노출됩니다" : "✓ 수정 저장됨");
      setTick((n) => n + 1);
      onAfterSave?.();
    } finally { setBusy(null); }
  }

  async function fork(sourceId: string) {
    setBusy(`fork:${sourceId}`);
    setMsg(null);
    try {
      const r = await fetch("/api/qa/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fork", sourceId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || "복사 실패"); return; }
      setMsg("✓ 내 정리로 복사됨 — 이제 자유롭게 수정 가능");
      setTick((n) => n + 1);
      onAfterSave?.();
    } finally { setBusy(null); }
  }

  async function remove() {
    if (!myItem) return;
    if (!confirm("내 정리 페이지를 삭제할까요?")) return;
    setBusy("delete");
    try {
      const r = await fetch(`/api/qa/organize?id=${encodeURIComponent(myItem.id)}`, { method: "DELETE" });
      if (!r.ok) { setMsg("삭제 실패"); return; }
      setMsg("삭제됨");
      setDraft(null);
      setTick((n) => n + 1);
      onAfterSave?.();
    } finally { setBusy(null); }
  }

  if (!rootId) {
    return <div className="text-[12px] text-gray-400 p-3">왼쪽에서 답을 선택하거나, 가운데에서 새 대화를 시작한 뒤 여기서 정리하세요.</div>;
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="text-[11px] text-gray-500">
        이 대화를 다음 사람이 검색해서 쓸 수 있게 정리합니다. AI가 초안을 만들어주고, 당신이 첨삭한 결과는 <strong>당신의 소유</strong>로 저장됩니다.
      </div>

      {/* AI 자동 정리 + 저장 */}
      <div className="border rounded p-3 bg-gray-50/60">
        <div className="flex items-center gap-2 mb-2">
          <button
            className="text-[11px] px-2 py-1 rounded border border-violet-300 bg-white hover:bg-violet-50 disabled:opacity-50"
            onClick={aiDraft}
            disabled={busy === "draft" || !signedIn}
            title={signedIn ? "AI가 가지 전체를 보고 정리 초안을 작성합니다 (LLM 호출 1회 차감)" : "로그인 필요"}
          >{busy === "draft" ? "AI 정리 중…" : (draft ? "🔁 다시 정리" : "🤖 AI 자동 정리")}</button>
          {draftMeta?.tier && (
            <span className="text-[10px] text-gray-500">
              호출: {draftMeta.tier} · {draftMeta.modelUsed}{draftMeta.quotaAfter ? ` · 무료 ${draftMeta.quotaAfter.freeUsedToday}/${draftMeta.quotaAfter.freeQuotaPerDay} · 🎫 ${draftMeta.quotaAfter.pointBalance}` : ""}
            </span>
          )}
        </div>

        {draft ? (
          <div className="flex flex-col gap-2">
            <Field label="제목" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
            <Field label="한 줄 요약 (검색에서 보일 문장)" value={draft.summary_line} onChange={(v) => setDraft({ ...draft, summary_line: v })} />
            <Field label="분류 (선택)" value={draft.category || ""} onChange={(v) => setDraft({ ...draft, category: v })} placeholder="예: 사출/생산" />

            <div>
              <div className="text-[11px] text-gray-600 mb-0.5">검색 키워드</div>
              <div className="flex flex-wrap gap-1 mb-1">
                {draft.keywords.map((k, i) => (
                  <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800 inline-flex items-center gap-1">
                    {k}
                    <button className="text-blue-500 hover:text-blue-800" onClick={() => setDraft({ ...draft, keywords: draft.keywords.filter((_, j) => j !== i) })}>×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <input className="flex-1 border rounded px-2 py-1 text-sm" placeholder="키워드 추가 후 Enter" value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && kwInput.trim()) { e.preventDefault(); setDraft({ ...draft, keywords: [...draft.keywords, kwInput.trim()].slice(0, 15) }); setKwInput(""); } }}
                />
              </div>
            </div>

            <div>
              <div className="text-[11px] text-gray-600 mb-0.5">본문 (마크다운)</div>
              <textarea
                className="w-full border rounded px-2 py-1 text-sm font-mono min-h-[180px]"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </div>

            {draft.verification_candidates && draft.verification_candidates.length > 0 && (
              <div>
                <div className="text-[11px] text-gray-600 mb-0.5">검증 후보 지표 (효과 측정용)</div>
                <ul className="flex flex-col gap-1">
                  {draft.verification_candidates.map((v, i) => (
                    <li key={i} className="text-[11px] flex items-center gap-2 border rounded px-2 py-1">
                      <strong>{v.metric}</strong>
                      <span className="text-gray-500">{v.direction === "lower_better" ? "↓ 작을수록 좋음" : "↑ 클수록 좋음"}</span>
                      {v.rationale && <span className="text-gray-500 truncate">— {v.rationale}</span>}
                      <button className="ml-auto text-gray-400 hover:text-red-600" onClick={() => setDraft({ ...draft, verification_candidates: (draft.verification_candidates || []).filter((_, j) => j !== i) })}>×</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 mt-2">
              {myItem && (
                <button className="text-[11px] px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50" onClick={remove} disabled={busy === "delete"}>삭제</button>
              )}
              <button
                className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                onClick={save}
                disabled={busy === "save"}
              >{busy === "save" ? "저장 중…" : (myItem ? "수정 저장" : "정리해서 공유하기")}</button>
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-gray-500">
            {loading ? "로딩…" : "위 [🤖 AI 자동 정리] 버튼을 누르거나, 직접 작성하려면 아래에서 시작."}
            {!loading && (
              <div className="mt-2">
                <button
                  className="text-[11px] px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                  onClick={() => setDraft({ title: "", summary_line: "", body: "", keywords: [], category: "", verification_candidates: [] })}
                >✍ 직접 정리 시작</button>
              </div>
            )}
          </div>
        )}

        {msg && <div className="text-[12px] text-gray-700 mt-2">{msg}</div>}
      </div>

      {/* 본문 wikilink 미리보기 + backlinks (내 페이지 저장된 경우) */}
      {myItem && (
        <div className="border rounded p-3">
          <div className="text-[11px] text-gray-500 mb-2">연결</div>
          {myItem.outgoingLinks && myItem.outgoingLinks.length > 0 ? (
            <div className="mb-2">
              <div className="text-[10px] text-gray-500">→ 이 페이지에서 가리키는 다른 정리 ({myItem.outgoingLinks.length})</div>
              <ul className="flex flex-col gap-0.5 mt-0.5">
                {myItem.outgoingLinks.map((l, i) => (
                  <li key={i} className="text-[11px] flex items-center gap-1">
                    <span className="text-blue-700">[[</span>
                    <span className="text-blue-700 underline cursor-pointer" title={l.targetTitle}>{l.surfaceText || l.targetTitle}</span>
                    <span className="text-blue-700">]]</span>
                    <span className="text-gray-400 text-[10px] ml-1">→ {l.targetTitle}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="text-[11px] text-gray-400">본문에 [[다른-정리-id]] 형태로 다른 페이지를 인용하면 여기에 표시됩니다. (AI 자동 정리가 후보 페이지를 분석해서 자동 삽입)</div>
          )}
          {backlinks.length > 0 && (
            <div className="mt-2 border-t pt-2">
              <div className="text-[10px] text-gray-500">← 이 페이지를 참조하는 다른 정리 ({backlinks.length})</div>
              <ul className="flex flex-col gap-1 mt-0.5">
                {backlinks.map((b, i) => (
                  <li key={i} className="text-[11px] border-l-2 border-violet-200 pl-2">
                    <div className="font-medium text-gray-800">{b.sourceTitle}</div>
                    <div className="text-gray-600 line-clamp-1">{b.sourceSummary}</div>
                    <div className="text-[10px] text-gray-400">{b.sourceOwner}{b.surfaceText ? ` · "${b.surfaceText}"` : ""}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 다른 사람의 정리 (있으면) */}
      {others.length > 0 && (
        <div className="border rounded p-3">
          <div className="text-[11px] text-gray-500 mb-2">다른 사용자의 정리 ({others.length})</div>
          <ul className="flex flex-col gap-2">
            {others.map((o) => (
              <li key={o.id} className="border rounded p-2 bg-white">
                <div className="text-[12px] font-medium">{o.title}</div>
                <div className="text-[11px] text-gray-600 mt-0.5">{o.summaryLine}</div>
                <div className="text-[10px] text-gray-400 mt-1">{o.organizedBy} · {new Date(o.organizedAt).toLocaleDateString()}</div>
                <div className="flex justify-end mt-1">
                  <button
                    className="text-[10px] px-2 py-0.5 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
                    onClick={() => fork(o.id)}
                    disabled={busy === `fork:${o.id}`}
                    title="이 정리를 내 정리로 복사 (이후 자유 수정)"
                  >📋 내 것으로 복사</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
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
