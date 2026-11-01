import { Badge, fmtDate, type Tone } from "@/components/ui";

const SCAN: Record<string, { label: string; tone: Tone; tip: string }> = {
  CLEAN: { label: "Scanned: clean", tone: "green", tip: "Checked by the malware scanner" },
  NOT_SCANNED: { label: "Not virus-checked", tone: "amber", tip: "No virus scanner is set up yet. The file's type, content and size were checked, but treat it as unverified. It downloads as a file and never opens in the browser." },
  PENDING: { label: "Virus check pending", tone: "amber", tip: "Waiting for the virus scanner. It cannot be downloaded until the check finishes." },
  SCAN_FAILED: { label: "Held: check failed", tone: "amber", tip: "The virus check could not finish, so the file is held. Ask an administrator." },
  INFECTED: { label: "Blocked: failed scan", tone: "rose", tip: "The malware scanner rejected this file; it cannot be downloaded" },
};

/** The scan state exactly as recorded: a file that was never scanned is never shown as clean. */
export function ScanBadge({ status }: { status: string }) {
  const s = SCAN[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "slate" as Tone, tip: "" };
  return <Badge tone={s.tone} title={s.tip}>{s.label}</Badge>;
}

/** Evidence attached to a record. Downloads go through /api/evidence, which checks permission and logs the download. */
export function EvidenceList({ docs }: { docs: { id: string; filename: string; scanStatus: string; createdAt: Date; sizeBytes: number }[] }) {
  if (!docs.length) return <p className="text-[13.5px] text-slate-600">No evidence attached yet.</p>;
  return (
    <ul className="rows">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13.5px]">
          <span className="min-w-0"><a href={`/api/evidence/${d.id}`} className="break-all" data-no-progress="">{d.filename}</a> <span className="text-slate-600">· {Math.max(1, Math.ceil(d.sizeBytes / 1024))} KB · {fmtDate(d.createdAt)}</span></span>
          <ScanBadge status={d.scanStatus} />
        </li>
      ))}
    </ul>
  );
}

/** Uploads a file straight onto a record, so nobody has to upload it elsewhere and find it again. */
export function EvidenceUpload({ action, back, linkedType, linkedId, compact = false }: { action: (fd: FormData) => Promise<void>; back: string; linkedType: string; linkedId: string; compact?: boolean }) {
  return (
    <form action={action} className={`${compact ? "mt-2" : "mt-3 border-t border-slate-200 pt-3"} space-y-2`}>
      <input type="hidden" name="back" value={back} /><input type="hidden" name="linkedType" value={linkedType} /><input type="hidden" name="linkedId" value={linkedId} />
      <label className="block"><span className="label">Attach a file</span><input type="file" name="file" required accept=".pdf,.docx,.png,.jpg,.jpeg,.txt,.csv" className="block w-full text-[13px]" /></label>
      <label className="block"><span className="label">What it shows (optional)</span><input name="description" maxLength={300} className="input" /></label>
      <button className="btn-secondary py-1">Upload</button>
      <p className="text-[12px] text-slate-500">PDF, Word, images, text or CSV up to 10 MB.</p>
    </form>
  );
}
