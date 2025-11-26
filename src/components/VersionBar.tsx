"use client";

import { useEffect, useState } from "react";

export default function VersionBar() {
  const [info, setInfo] = useState<{ sha?: string; title?: string; message?: string } | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (active) setInfo(j || null);
      } catch {}
    })();
    return () => { active = false; };
  }, []);
  return (
    <div className="text-[11px] px-3 py-1 bg-gray-50 border-b border-gray-200 text-gray-700 truncate">
      {info?.title ? (
        <span>
          Latest: {info.title}{info.sha ? ` (${info.sha.slice(0,7)})` : ""}
          {info.message ? <span className="text-gray-500"> · {info.message.slice(0, 80)}{info.message.length > 80 ? "…" : ""}</span> : null}
        </span>
      ) : (
        <span>Latest version information is loading…</span>
      )}
    </div>
  );
}
