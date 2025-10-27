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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[92%] max-w-sm rounded bg-white p-4 shadow-lg">
        <h3 className="text-base font-semibold">Publish work</h3>
        <div className="mt-3 space-y-2">
          <input
            className="w-full rounded border border-gray-300 p-2 text-sm"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="w-full rounded border border-gray-300 p-2 text-sm"
            placeholder="Topic (e.g., keyword)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <textarea
            className="w-full rounded border border-gray-300 p-2 text-sm"
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
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border">Cancel</button>
          <button
            onClick={() => onPublish(title, description, topic, isPublic)}
            className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white"
          >Publish</button>
        </div>
      </div>
    </div>
  );
}
