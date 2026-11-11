import Link from "@/components/link";
import { Badge, Card, Empty, fmtDate } from "@/components/ui";
import type { Ctx } from "@/server/auth/rbac";
import { serviceUserAiAudit } from "@/server/care/coordinator/exceptions";
import { ExceptionList } from "./exception-list";

const SETUP_TONE = { PROCESSING: "teal", READY: "green", NEEDS_ATTENTION: "amber", FAILED: "rose" } as const;
const STATUS_FILTERS = [["OPEN", "Open"], ["RESOLVED", "Resolved"], ["ALL", "All"]] as const;
const SEVERITY_FILTERS = [["", "Any severity"], ["URGENT", "Urgent"], ["REVIEW", "Review required"], ["FOLLOW_UP", "Follow-up"], ["INFO", "Informational"]] as const;

/**
 * The person's Audit & Exceptions tab (owner's brief of 7 Nov 2026, sections 8, 9 and 11): what CSB AI did with their
 * documents, every record it saved with its source and who or what decided it, corrections made since, and the open
 * exceptions. Corrections are made on the record's own tab with its usual permissions; nothing is edited here.
 */
export async function ServiceUserAiAudit({ ctx, serviceUserId, base, sp }: { ctx: Ctx; serviceUserId: string; base: string; sp: Record<string, string | undefined> }) {
  const status = STATUS_FILTERS.some(([k]) => k === sp.ex) ? (sp.ex as "OPEN" | "RESOLVED" | "ALL") : "OPEN";
  const severity = SEVERITY_FILTERS.some(([k]) => k && k === sp.sev) ? sp.sev : undefined;
  const a = await serviceUserAiAudit(ctx, serviceUserId, { status, severity });
  const back = `${base}?tab=ai-audit${sp.ex ? `&ex=${sp.ex}` : ""}${sp.sev ? `&sev=${sp.sev}` : ""}`;
  return (
    <div className="space-y-3">
      <Card title="AI setup summary">
        {a.setups.length ? (
          <ul className="space-y-3">
            {a.setups.map((s) => (
              <li key={s.id} className="border-l-2 border-slate-200 pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/rota/coordinator/${s.id}?step=setup`} className="font-medium">{s.reference}</Link>
                  <span className="text-body">{s.title}</span>
                  <Badge tone={s.setupStatus ? (SETUP_TONE[s.setupStatus as keyof typeof SETUP_TONE] ?? "slate") : "slate"}>{s.setupLabel}</Badge>
                </div>
                <p className="text-meta text-slate-600">
                  {s.documents.length} source document{s.documents.length === 1 ? "" : "s"} ({s.documents.map((d) => d.name).join(", ") || "none"}). {s.finishedAt ? `Processed ${fmtDate(s.finishedAt, true)}` : "Not processed automatically"}{s.startedBy ? `, started by ${s.startedBy}` : ""}.
                </p>
                {s.summary.length ? <ul className="mt-1 list-disc pl-5 text-body">{s.summary.map((l) => <li key={l}>{l}</li>)}</ul> : null}
                <p className="mt-1 text-meta text-slate-600">Saved automatically by CSB AI: {s.counts.automatic} · Decided by a person: {s.counts.human} · Repeats consolidated: {s.counts.consolidated} · Still waiting: {s.counts.waiting}{s.report?.sections.some((x) => x.status === "FAILED") ? ` · Failed: ${s.report.sections.filter((x) => x.status === "FAILED").map((x) => x.label).join(", ")}` : ""}</p>
                {s.failures.map((f) => <p key={f} className="text-meta text-[#a3242c]">{f}</p>)}
              </li>
            ))}
          </ul>
        ) : <Empty>No documents have been set up by CSB AI for this person. Records here were entered by hand.</Empty>}
      </Card>

      <Card title="Exceptions" actions={
        <form className="flex flex-wrap items-center gap-2" aria-label="Filter exceptions">
          <input type="hidden" name="tab" value="ai-audit" />
          <label className="sr-only" htmlFor="ex">Status</label>
          <select id="ex" name="ex" defaultValue={status} className="input w-auto py-1">{STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="sr-only" htmlFor="sev">Severity</label>
          <select id="sev" name="sev" defaultValue={severity ?? ""} className="input w-auto py-1">{SEVERITY_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn-secondary py-1">Show</button>
        </form>
      }>
        <ExceptionList items={a.exceptions.items} hidden={status === "RESOLVED" ? 0 : a.exceptions.hidden} back={back} profileBase={base} empty={status === "OPEN" ? "No open exceptions." : "None."} />
      </Card>

      <Card title={`Corrections since setup (${a.corrections.length})`}>
        {a.corrections.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th scope="col">Field</th><th scope="col">Saved from the documents</th><th scope="col">On the record now</th><th scope="col">Changed by</th><th scope="col">Original source</th></tr></thead>
              <tbody>{a.corrections.map((c, i) => <tr key={i}><td>{c.field}</td><td>{c.saved}</td><td>{c.now}</td><td>{c.changedBy ? `${c.changedBy}, ${fmtDate(c.changedAt, true)}` : "Not recorded"}</td><td className="text-meta">{c.source}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <Empty>Nothing CSB AI saved has been changed since. Correct any detail on its own tab (Personal details, Contacts, Care package, Template and so on); the change is recorded there with your name and time.</Empty>}
      </Card>

      <Card title={`What CSB AI saved, with its source (${a.saved.length})`}>
        {a.saved.length ? (
          <details>
            <summary className="cursor-pointer text-body">Show every saved item</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="table">
                <thead><tr><th scope="col">Section</th><th scope="col">Information</th><th scope="col">Source</th><th scope="col">Decided</th><th scope="col"><span className="sr-only">Record</span></th></tr></thead>
                <tbody>
                  {a.saved.map((x) => (
                    <tr key={x.id}>
                      <td>{x.section}</td>
                      <td><span className="font-medium">{x.label}</span><span className="block text-meta text-slate-700">{x.value}{x.existing ? " (already on the record, not added twice)" : ""}</span></td>
                      <td className="text-meta">{x.source}<span className="block text-slate-600">{x.verification}</span></td>
                      <td className="text-meta">{x.provenance}<span className="block text-slate-600">{fmtDate(x.savedAt, true)}</span></td>
                      <td>{x.recordTab ? <Link href={`${base}?tab=${x.recordTab}`} className="whitespace-nowrap">Open</Link> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : <Empty>Nothing was saved from documents.</Empty>}
      </Card>

      <Card title="Audit history">
        <ol id="audit-trail" className="space-y-1.5 text-body" aria-label="Audit history, newest first">
          {a.trail.length ? a.trail.map((t) => (
            <li key={t.id} className="border-l-2 border-slate-200 pl-3">
              <span className="font-medium">{t.action.replace(/^(coordinator|serviceUser)\./, "").replace(/[.-]/g, " ")}</span>
              {t.automated ? <> <Badge tone="violet">CSB AI</Badge></> : null}
              <span className="block text-meta text-slate-600">{t.by} · {fmtDate(t.at, true)}</span>
            </li>
          )) : <li><Empty>No history yet.</Empty></li>}
        </ol>
      </Card>
    </div>
  );
}
