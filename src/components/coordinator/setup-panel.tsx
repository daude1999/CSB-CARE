import Link from "@/components/link";
import { Badge, Card, fmtDate } from "@/components/ui";
import { chooseIdentityAction, confirmNewPersonAction, provideNameAction, runAutomaticSetupAction } from "@/app/coordinator-actions";
import { SETUP_STATUS, setupSummaryLines, type SetupReport } from "@/server/care/coordinator/auto-setup";
import type { ExceptionView, identityChoices } from "@/server/care/coordinator/exceptions";
import type { IntakeView } from "@/server/care/coordinator/intake";
import { inReview } from "@/lib/care-coordinator-rules";
import { ExceptionList } from "./exception-list";
import { ReadProgress } from "./read-progress";

const TONE = { PROCESSING: "teal", READY: "green", NEEDS_ATTENTION: "amber", FAILED: "rose" } as const;
const STAGE_LABEL: Record<string, string> = { TRIAGE: "Facts sorted", IDENTITY: "Identity checked", RECORDS: "Records saved", ROTA: "Proposed rota built", EXCEPTIONS: "Exceptions raised", VERIFIED: "Read back and verified" };

/**
 * The intake's first screen since automatic setup (7 Nov 2026): what CSB AI did with the documents, links to the
 * person's records, the one identity question when there is one, and only the exceptions that need a person. The
 * detailed fact review stays available as an advanced tool, never as a queue to work through.
 */
export function SetupPanel({ view, report, exceptions, hidden, identity, back }: { view: IntakeView; report: SetupReport | null; exceptions: ExceptionView[]; hidden: number; identity: Awaited<ReturnType<typeof identityChoices>>; back: string }) {
  const { intake } = view;
  const status = (intake.setupStatus ?? null) as keyof typeof SETUP_STATUS | null;
  const busy = view.documents.some((d) => d.readStage && ["QUEUED", "READING", "PREPARING", "RETRYING"].includes(d.readStage));
  const profile = view.person ? `/rota/service-users/${view.person.id}` : null;
  const open = inReview(intake.status) || intake.status === "COMPLETED";
  const runForm = (label: string, primary = false) => (
    <form action={runAutomaticSetupAction}>
      <input type="hidden" name="back" value={back} /><input type="hidden" name="intakeId" value={intake.id} /><input type="hidden" name="mode" value={intake.mode} />
      <button className={primary ? "btn-primary" : "btn-secondary"}>{label}</button>
    </form>
  );
  const attention = report ? report.exceptions.URGENT + report.exceptions.REVIEW + report.exceptions.FOLLOW_UP : 0;
  const created = intake.mode === "NEW" && !!report?.records.personal;
  const heading = !report ? "Automatic setup has not run for this intake" : report.blocked?.kind === "READING" || status === "PROCESSING" ? "Processing the documents" : report.blocked ? "One question before CSB AI can carry on" : status === "FAILED" ? "Setup did not finish" : intake.mode === "DOCUMENT" ? "Supporting document processed" : created ? "Service user created successfully" : "Support plan processed";

  return (
    <div className="space-y-3">
      {busy ? <ReadProgress intakeId={intake.id} /> : null}
      <Card
        title={<span className="flex flex-wrap items-center gap-2">{heading}{status ? <Badge tone={TONE[status]}>{SETUP_STATUS[status]}</Badge> : null}</span>}
        actions={open && report && !busy ? runForm(status === "FAILED" ? "Run setup again" : "Check again") : null}
      >
        {!report ? (
          <div className="space-y-2 text-body">
            <p>This intake was started before CSB AI set records up by itself{view.documents.length ? "" : ", or has no documents yet"}. Running the automatic setup now keeps every document, fact and decision already made: CSB AI only sorts the facts still waiting, saves them into the person&apos;s records, skips anything already saved and lists only what needs a person.</p>
            {open && view.documents.length && !busy ? runForm("Run automatic setup", true) : !view.documents.length ? <p className="text-slate-600">Upload the documents under Documents first.</p> : null}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0 space-y-2 text-body">
              {report.blocked ? <p className={report.blocked.kind === "READING" ? "text-slate-700" : "font-medium text-[#8a5a00]"}>{report.blocked.message}</p> : null}
              {!report.blocked || report.blocked.kind === "READING" ? (
                <ul className="list-disc space-y-0.5 pl-5">{setupSummaryLines(report, intake.mode).map((l) => <li key={l}>{l}</li>)}</ul>
              ) : null}
              {report.sections.filter((s) => s.status !== "SAVED").map((s) => <p key={s.section} className={s.status === "FAILED" ? "text-[#a3242c]" : "text-slate-700"}>{s.label}: {s.status === "FAILED" ? "not saved" : "left for review"}. {s.error}</p>)}
              {report.failures.map((f) => <p key={f} className="text-[#a3242c]">{f}</p>)}
              {report.rota?.error ? <p className="text-[#a3242c]">Proposed rota not built: {report.rota.error}</p> : null}
              <p className="text-meta text-slate-600">
                {report.finishedAt ? `Finished ${fmtDate(report.finishedAt, true)}.` : `Started ${fmtDate(report.startedAt, true)}.`} {intake.setupStage ? `Last stage: ${STAGE_LABEL[intake.setupStage] ?? intake.setupStage}.` : ""} CSB AI sorted {report.triage.routine} routine fact{report.triage.routine === 1 ? "" : "s"}, consolidated {report.triage.duplicates} repeat{report.triage.duplicates === 1 ? "" : "s"} and kept {report.triage.notUsed} historical or superseded value{report.triage.notUsed === 1 ? "" : "s"} for reference only. The care plan and risk assessments were saved straight into the record with their source; nothing needed approving. Visits were not published and nothing was sent to carers.
              </p>
            </div>
            {profile ? (
              <nav aria-label="Open the person's records" className="flex flex-col gap-1.5">
                <Link href={profile} className="btn-primary text-center">Open service user profile</Link>
                <Link href={`${profile}?tab=package`} className="btn-secondary text-center">View care package</Link>
                <Link href={`${profile}?tab=care-plans`} className="btn-secondary text-center">View care plan</Link>
                <Link href={`${profile}?tab=rota`} className="btn-secondary text-center">View draft rota</Link>
                <Link href={`${profile}?tab=ai-audit`} className="btn-secondary text-center">Review exceptions{attention ? ` (${attention})` : ""}</Link>
                <Link href={`${profile}?tab=ai-audit#audit-trail`} className="btn-secondary text-center">View audit history</Link>
              </nav>
            ) : null}
          </div>
        )}
      </Card>

      {report?.blocked?.kind === "POSSIBLE_DUPLICATE" && report.blocked.match ? (
        <Card title="This person may already exist">
          <p className="text-body">{report.blocked.match.name} ({report.blocked.match.reference}) is already on record: {report.blocked.match.reason.toLowerCase()}. CSB AI never creates a second record for someone who may already exist, and never merges two people.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={`/rota/service-users/${report.blocked.match.id}`} className="btn-secondary">Open existing record</Link>
            <form action={confirmNewPersonAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="intakeId" value={intake.id} /><button className="btn-primary">Confirm a new person</button></form>
          </div>
          <p className="mt-2 text-meta text-slate-600">If it is the same person, cancel this intake and start a &ldquo;B. Updated or revised plan&rdquo; intake for them with the same documents.</p>
        </Card>
      ) : null}

      {report?.blocked?.kind === "IDENTITY_CONFLICT" && identity.length ? (
        <Card title="Choose the right value">
          <div className="space-y-3">
            {identity.map((g) => (
              <fieldset key={g.destination}>
                <legend className="label">{g.label}</legend>
                {g.restricted ? <p className="text-body text-slate-600">A registered manager chooses this value.</p> : (
                  <div className="flex flex-wrap gap-2">
                    {g.options.map((o) => (
                      <form key={o.factId} action={chooseIdentityAction}>
                        <input type="hidden" name="back" value={back} /><input type="hidden" name="intakeId" value={intake.id} /><input type="hidden" name="factId" value={o.factId} />
                        <button className="btn-secondary">Use &ldquo;{o.value}&rdquo; <span className="text-caption text-slate-600">({o.source})</span></button>
                      </form>
                    ))}
                  </div>
                )}
              </fieldset>
            ))}
          </div>
        </Card>
      ) : null}

      {report?.blocked?.kind === "NAME_MISSING" ? (
        <Card title="The person's name is needed">
          <form action={provideNameAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="back" value={back} /><input type="hidden" name="intakeId" value={intake.id} />
            <p className="w-full text-body">CSB AI could not read the person&apos;s name clearly. Type it as the document gives it and setup carries on.</p>
            <label className="block"><span className="label">First name</span><input name="firstName" required maxLength={100} className="input" /></label>
            <label className="block"><span className="label">Last name</span><input name="lastName" required maxLength={100} className="input" /></label>
            <button className="btn-primary">Save name and continue</button>
          </form>
        </Card>
      ) : null}

      {report && (exceptions.length || hidden) ? (
        <Card title={`Exceptions (${exceptions.length + hidden})`}>
          <ExceptionList items={exceptions} hidden={hidden} back={back} profileBase={profile} empty="Nothing needs attention." />
        </Card>
      ) : null}
    </div>
  );
}
