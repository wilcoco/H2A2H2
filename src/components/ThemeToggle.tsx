"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { getActiveTheme, toggleTheme, type Theme } from "@/lib/theme";

export default function ThemeToggle() {
  const [theme, setT] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setT(getActiveTheme());
    setMounted(true);
  }, []);

  function onClick() {
    setT(toggleTheme());
  }

  if (!mounted) return <span className="inline-block w-7 h-7" />;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
      title={theme === "dark" ? "라이트 모드" : "다크 모드"}
      className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-md)] text-[color:var(--text-muted)] hover:text-[color:var(--text-normal)] hover:bg-[color:var(--bg-hover)] transition-colors"
    >
      {theme === "dark" ? <Sun size={14} strokeWidth={1.75} /> : <Moon size={14} strokeWidth={1.75} />}
    </button>
  );
}
