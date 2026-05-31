"use client";

import { useEffect, useState, useCallback } from "react";

const KEY = "nw_advanced_mode";

// 고급 모드 = nightwish 메커니즘 컨트롤(거버넌스/검증/포크/잠복/시빌/decay 등) 노출.
// 기본 OFF — 일반 사용자에게는 검색·질문·답·도움됨만 보임.
export function useAdvancedMode(): [boolean, (next: boolean) => void] {
  const [advanced, setAdvanced] = useState<boolean>(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      setAdvanced(v === "1");
    } catch {}
  }, []);

  const set = useCallback((next: boolean) => {
    setAdvanced(next);
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch {}
  }, []);

  return [advanced, set];
}
