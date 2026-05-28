"use client";

import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onPublish: (title: string, description?: string, topic?: string, isPublic?: boolean) => void;
};

export default function PublishModal({ open, onClose, onPublish }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [topic, setTopic] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-[92%] max-w-sm rounded-[var(--radius-lg)] bg-[color:var(--bg-elevated)] text-[color:var(--text-normal)] p-4 shadow-2xl border border-[color:var(--border)]">
        <h3 className="text-base font-semibold">Publish work</h3>
        <div className="mt-3 space-y-2">
          <input
            className="w-full rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--bg-primary)] p-2 text-sm focus:outline-none focus:border-[color:var(--accent)]"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="w-full rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--bg-primary)] p-2 text-sm focus:outline-none focus:border-[color:var(--accent)]"
            placeholder="Topic (e.g., keyword)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <textarea
            className="w-full rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--bg-primary)] p-2 text-sm focus:outline-none focus:border-[color:var(--accent)]"
            placeholder="Description (optional)"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            Public
          </label>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-[var(--radius-md)] border border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]">Cancel</button>
          <button
            onClick={() => onPublish(title, description, topic, isPublic)}
            className="text-sm px-3 py-1.5 rounded-[var(--radius-md)] bg-[color:var(--accent)] text-[color:var(--accent-fg)] hover:bg-[color:var(--accent-hover)]"
          >Publish</button>
        </div>
      </div>
    </div>
  );
}
