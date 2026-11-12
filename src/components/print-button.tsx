"use client";

import { Paperclip } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

/** Opens the browser's print dialog for the current page. */
export function PrintButton({ className, children }: { className?: string; children: ReactNode }) {
  return <button type="button" className={className} onClick={() => window.print()}>{children}</button>;
}

/** A compact "Add Photo" button for a single optional photograph, showing the chosen file's name. */
export function PhotoButton({ name, accept, maxBytes }: { name: string; accept: string; maxBytes: number }) {
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="bm-secondary cursor-pointer focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2">
        <Paperclip size={16} aria-hidden /> {file ? "Change photo" : "Add Photo"}
        <input type="file" name={name} accept={accept} className="sr-only" onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          const msg = f && f.size > maxBytes ? `This photo is ${(f.size / 1048576).toFixed(1)} MB. Photos must be ${Math.round(maxBytes / 1048576)} MB or smaller.` : "";
          e.currentTarget.setCustomValidity(msg);
          setError(msg || null);
          setFile(f?.name ?? null);
        }} />
      </label>
      {error ? <span role="alert" className="text-caption font-medium text-[#a3242c]">{error}</span> : file ? <span className="max-w-[180px] truncate text-caption text-slate-600">{file}</span> : <span className="text-caption text-slate-500">Optional</span>}
    </span>
  );
}
