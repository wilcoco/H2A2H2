"use client";

import { useEffect, useState } from "react";

const KEY = "nw_onboard_seen_v1";

type Props = {
  forceOpen?: boolean;        // 헤더의 '도움말' 클릭 시 다시 띄우기
  onClose?: () => void;
};

export default function OnboardingModal({ forceOpen, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (forceOpen) { setOpen(true); setStep(0); return; }
    try {
      const seen = typeof window !== "undefined" ? localStorage.getItem(KEY) : "1";
      if (!seen) { setOpen(true); setStep(0); }
    } catch {}
  }, [forceOpen]);

  if (!open) return null;

  function close() {
    try { localStorage.setItem(KEY, "1"); } catch {}
    setOpen(false);
    onClose?.();
  }

  const steps = [
    {
      title: "1. 먼저 검색해보세요",
      body: "왼쪽 패널에서 궁금한 걸 검색합니다. 누군가 이미 좋은 답을 만들어놨을 수 있어요. 좋은 답에는 ✓ 결과 확인됨 배지가 붙어 있습니다.",
      hint: "← 왼쪽 검색창",
    },
    {
      title: "2. 없으면 AI에게 물어보세요",
      body: "검색 결과가 마음에 안 들면 가운데에서 AI와 대화하세요. 답이 좋다면 '저장'을 눌러 다른 사람도 보게 합니다.",
      hint: "↑ 가운데 패널",
    },
    {
      title: "3. 답에 반응하세요",
      body: "도움됐으면 👍, 동의하지 않으면 다른 답을 직접 적어 올릴 수 있어요. 시스템은 답을 하나로 합치지 않습니다 — 다른 의견은 별도 가지로 살아남습니다.",
      hint: "↓ 가운데 아래",
    },
  ];

  const s = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onMouseDown={close}>
      <div className="bg-white text-gray-900 rounded-lg shadow-xl w-[min(480px,92vw)] p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-gray-400">{step + 1} / {steps.length}</div>
          <button className="text-xs text-gray-500 hover:text-gray-800" onClick={close}>건너뛰기</button>
        </div>
        <div className="text-lg font-semibold mb-1">{s.title}</div>
        <div className="text-sm text-gray-700 leading-relaxed">{s.body}</div>
        <div className="mt-3 text-[12px] text-violet-700 bg-violet-50 border border-violet-200 rounded px-2 py-1.5">{s.hint}</div>
        <div className="flex items-center justify-end gap-2 mt-5">
          {step > 0 && (
            <button className="text-xs px-3 py-1.5 rounded border" onClick={() => setStep((n) => n - 1)}>이전</button>
          )}
          {!last ? (
            <button className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={() => setStep((n) => n + 1)}>다음</button>
          ) : (
            <button className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={close}>시작</button>
          )}
        </div>
      </div>
    </div>
  );
}
