"use client";

import { useId, useState } from "react";

/**
 * A file picker that refuses files over the upload limit before anything is sent, so the person sees a clear
 * message instead of a failed page (the live host rejects bodies over 4.5 MB). The server checks again.
 */
export function PrivateFileInput({ name, accept, maxBytes, required = false, label, hint }: { name: string; accept: string; maxBytes: number; required?: boolean; label: string; hint?: string }) {
  const [error, setError] = useState<string | null>(null);
  const id = `file-${name}-${useId().replace(/:/g, "")}`;
  return (
    <label htmlFor={id} className="block">
      <span className="label">{label}</span>
      <input
        id={id}
        type="file"
        name={name}
        accept={accept}
        required={required}
        aria-describedby={`${id}-hint`}
        className="block w-full text-body file:mr-3 file:rounded-[6px] file:border-[1.5px] file:border-slate-500 file:bg-white file:px-3 file:py-1.5 file:text-body file:text-slate-800"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          const msg = f && f.size > maxBytes ? `This file is ${(f.size / 1048576).toFixed(1)} MB. Files must be ${Math.round(maxBytes / 1048576)} MB or smaller.` : "";
          e.currentTarget.setCustomValidity(msg);
          setError(msg || null);
        }}
      />
      <span id={`${id}-hint`} className={`mt-1 block text-meta ${error ? "font-medium text-[#a3242c]" : "text-slate-500"}`} role={error ? "alert" : undefined}>{error ?? hint}</span>
    </label>
  );
}
