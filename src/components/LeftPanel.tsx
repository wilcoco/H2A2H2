"use client";

import type { Work } from "@/types/graph";

type Props = {
  works: Work[];
  selectedWorkId?: string;
  onSelect: (id: string) => void;
};

export default function LeftPanel({ works, selectedWorkId, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">References</h2>
      <ul className="flex flex-col divide-y divide-gray-200/30">
        {works.map((w) => (
          <li
            key={w.id}
            className={`p-2 rounded ${
              selectedWorkId === w.id
                ? "bg-gray-100 dark:bg-gray-900"
                : "hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <button onClick={() => onSelect(w.id)} className="w-full text-left">
              <div className="flex items-center justify-between">
                <span className="font-medium">{w.title}</span>
                <span className="text-xs text-gray-500">score {w.investmentScore}</span>
              </div>
              {w.description && (
                <p className="text-xs text-gray-500 mt-1">{w.description}</p>
              )}
              <p className="text-xs text-gray-500 mt-1">{w.nodeCount} nodes</p>
            </button>
          </li>
        ))}
        {works.length === 0 && (
          <li className="text-sm text-gray-500 p-2">No works yet.</li>
        )}
      </ul>
    </div>
  );
}
