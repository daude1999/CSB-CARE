"use client";
import { useRef, useState } from "react";
import { CloudArrowUp, FileDoc, FilePdf, Warning, X } from "@phosphor-icons/react";
import { uploadPoliciesAction } from "@/app/actions";

const MAX_FILES = 10;
const MAX_TOTAL = 10 * 1024 * 1024;
const OK_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * The Upload policy form (owner's brief of 3 Nov 2026). Word and PDF files are dropped or browsed, checked here for
 * type and size so mistakes show before sending, and checked again on the server. Each file becomes a Draft v1 policy;
 * nothing is published automatically.
 */
export function UploadPolicyForm({ categories, owners, defaultOwner, back }: { categories: { code: string; name: string }[]; owners: { id: string; name: string }[]; defaultOwner: string; back: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const take = (list: FileList | null) => {
    if (!list || !input.current) return;
    input.current.files = list;
    setFiles([...list]);
  };
  const remove = (i: number) => {
    const dt = new DataTransfer();
    files.forEach((f, j) => j !== i && dt.items.add(f));
    if (input.current) input.current.files = dt.files;
    setFiles([...dt.files]);
  };
  const badType = files.filter((f) => !OK_TYPES.includes(f.type));
  const total = files.reduce((n, f) => n + f.size, 0);
  const problem = badType.length
    ? `${badType.map((f) => f.name).join(", ")}: only .docx and .pdf files can be uploaded.`
    : files.length > MAX_FILES
      ? `Upload up to ${MAX_FILES} files at a time.`
      : total > MAX_TOTAL
        ? `These files come to ${size(total)}. Upload up to 10 MB at a time.`
        : null;

  return (
    <form action={uploadPoliciesAction} onSubmit={() => setBusy(true)} className="space-y-4" data-testid="upload-policy-form">
      <input type="hidden" name="back" value={back} />
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center rounded-[12px] border-2 border-dashed px-4 py-6 text-center transition-colors focus-within:border-[#5b2bb5] ${over ? "border-[#5b2bb5] bg-[#f8f5ff]" : "border-[#d0d5dd] bg-[#f9fafb] hover:border-[#b9a6ea]"}`}
      >
        <CloudArrowUp size={28} aria-hidden="true" className="text-[#5b2bb5]" />
        <span className="mt-2 text-[14px] font-semibold text-[#101828]">Drag and drop files here, or <span className="text-[#5b2bb5] underline">browse</span></span>
        <span className="mt-1 text-[12.5px] text-[#475467]">Word (.docx) or PDF · up to {MAX_FILES} files, 10 MB in total</span>
        <input ref={input} type="file" name="files" multiple required accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(e) => take(e.currentTarget.files)} />
      </label>

      {files.length ? (
        <ul className="divide-y divide-[#f2f4f7] rounded-[10px] border border-[#eaecf0] text-[13px]" aria-label="Chosen files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2">
              {f.type === "application/pdf" ? <FilePdf size={18} aria-hidden="true" className="text-[#b42318]" /> : <FileDoc size={18} aria-hidden="true" className="text-[#175cd3]" />}
              <span className="min-w-0 flex-1 truncate text-[#101828]">{f.name}</span>
              <span className="tabular-nums text-[#667085]">{size(f.size)}</span>
              <button type="button" onClick={() => remove(i)} aria-label={`Remove ${f.name}`} className="rounded p-1 text-[#667085] hover:bg-[#f2f4f7]"><X size={14} /></button>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? <p role="alert" className="text-[13px] text-[#b42318]">{problem}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="upload-category">Category</label>
          <select id="upload-category" name="category" className="input" required defaultValue="">
            <option value="" disabled>Choose a category</option>
            {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="upload-owner">Policy owner</label>
          <select id="upload-owner" name="ownerId" className="input" required defaultValue={defaultOwner}>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      </div>
      <fieldset className="space-y-2 text-[13.5px] text-[#344054]">
        <legend className="sr-only">Upload options</legend>
        <label className="flex items-start gap-2"><input type="checkbox" name="duplicateCheck" defaultChecked className="pc-check mt-0.5" />Skip files whose title matches a policy already in the library</label>
        <label className="flex items-start gap-2"><input type="checkbox" name="extractText" defaultChecked className="pc-check mt-0.5" />Take editable text from Word files (you check it in the draft before review)</label>
      </fieldset>
      <p className="flex gap-2 rounded-[10px] border border-[#fedf89] bg-[#fffaeb] px-3 py-2.5 text-[13px] leading-5 text-[#b54708]">
        <Warning size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>Uploads are never published automatically. Each file becomes a Draft v1 with version history, and the original file is stored securely with the policy.</span>
      </p>
      <button type="submit" className="pc-btn w-full justify-center" disabled={busy || !files.length || Boolean(problem)}>
        {busy ? "Uploading…" : files.length > 1 ? `Upload ${files.length} policies` : "Upload policy"}
      </button>
    </form>
  );
}
