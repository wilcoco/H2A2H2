"use client";

import { useState } from "react";
import VerificationBadge from "./VerificationBadge";
import VerificationDialog from "./VerificationDialog";
import BookkeepPanel from "./BookkeepPanel";

type Props = {
  qaId?: string;
  rootId?: string;
  question?: string;
  answer?: string;
  signedIn: boolean;
  onForked?: (newQaId: string) => void;
  refreshKey?: number;
};

// 선택된 Q&A 위/아래에 붙는 얇은 nightwish 컨트롤 바:
//  - VerificationBadge (검증 게이트 상태 표시)
//  - "검증 추가" → VerificationDialog (AI 초안 + 사용자 편집)
//  - "포크" → 같은 질문에 대안 답변 새 가지로
export default function NightwishBar({ qaId, rootId, question, answer, signedIn, onForked, refreshKey }: Props) {
  const [openVerify, setOpenVerify] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [forkAnswer, setForkAnswer] = useState("");
  const [forkBusy, setForkBusy] = useState(false);
  const [forkMsg, setForkMsg] = useState<string | null>(null);
  const [savedBump, setSavedBump] = useState(0);

  if (!qaId) return null;

  async function doFork() {
    if (!qaId || !forkAnswer.trim()) return;
    setForkBusy(true);
    setForkMsg(null);
    try {
      const r = await fetch("/api/qa/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: qaId, answer: forkAnswer.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setForkMsg(j?.error || "포크 실패"); return; }
      setForkMsg(`포크 생성: ${j.id}`);
      setForkAnswer("");
      onForked?.(j.id);
      setTimeout(() => setForkOpen(false), 600);
    } catch {
      setForkMsg("포크 실패");
    } finally {
      setForkBusy(false);
    }
  }

  return (
    <div className="border-t border-gray-200/60 bg-gray-50/60 px-3 py-2 flex flex-wrap items-center gap-2">
      <VerificationBadge qaId={qaId} rootId={rootId} refreshKey={savedBump + (refreshKey || 0)} />
      <div className="ml-auto flex items-center gap-1">
        <button
          className="text-[11px] px-2 py-1 rounded border border-emerald-300 bg-white hover:bg-emerald-50 disabled:opacity-50"
          onClick={() => setOpenVerify(true)}
          disabled={!signedIn}
          title={signedIn ? "외부 측정으로 검증 추가" : "로그인 필요"}
        >+ 검증</button>
        <button
          className="text-[11px] px-2 py-1 rounded border border-blue-300 bg-white hover:bg-blue-50 disabled:opacity-50"
          onClick={() => setForkOpen((v) => !v)}
          disabled={!signedIn}
          title="같은 질문에 다른 답을 새 가지로 만듭니다 (수렴 거부, 입증 책임 본인)"
        >⑂ 포크</button>
        <button
          className="text-[11px] px-2 py-1 rounded border border-violet-300 bg-white hover:bg-violet-50 disabled:opacity-50"
          onClick={() => setBookOpen((v) => !v)}
          disabled={!signedIn}
          title="LLM이 가지 안 다른 노드와의 관계/모순/노트를 자동 분석 (적용은 사용자가 개별 승인)"
        >🔍 자동 정리</button>
      </div>
      {bookOpen && (
        <div className="basis-full mt-1 border-t pt-2">
          <BookkeepPanel qaId={qaId} signedIn={signedIn} onApplied={() => setSavedBump((n) => n + 1)} />
        </div>
      )}

      {forkOpen && (
        <div className="basis-full mt-1 flex flex-col gap-1 border-t pt-2">
          <div className="text-[11px] text-gray-600">대안 답변 (이 답이 다르다고 보는 이유와 새 주장):</div>
          <textarea
            className="w-full border rounded px-2 py-1 text-sm min-h-[80px]"
            value={forkAnswer}
            onChange={(e) => setForkAnswer(e.target.value)}
            placeholder="대안 답변 — 입증 책임은 당신에게 있습니다."
          />
          {forkMsg && <div className="text-[11px] text-gray-700">{forkMsg}</div>}
          <div className="flex justify-end gap-1">
            <button className="text-[11px] px-2 py-1 rounded border" onClick={() => setForkOpen(false)}>닫기</button>
            <button
              className="text-[11px] px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={doFork}
              disabled={forkBusy || !forkAnswer.trim()}
            >{forkBusy ? "생성 중…" : "포크 생성"}</button>
          </div>
        </div>
      )}

      <VerificationDialog
        qaId={qaId}
        question={question}
        answer={answer}
        open={openVerify}
        onClose={() => setOpenVerify(false)}
        onSaved={() => setSavedBump((n) => n + 1)}
      />
    </div>
  );
}
