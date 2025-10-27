"use client";

import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onPublish: (title: string, description?: string) => void;
};

export default function PublishModal({ open, onClose, onPublish }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

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
          <textarea
            className="w-full rounded border border-gray-300 p-2 text-sm"
            placeholder="Description (optional)"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border">Cancel</button>
          <button
            onClick={() => onPublish(title, description)}
            className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white"
          >Publish</button>
        </div>
      </div>
    </div>
  );
}
