import { requireRotaPage } from "@/server/auth/portals";
import { orNotFound } from "@/server/auth/page-guard";
import { getIntake } from "@/server/care/coordinator/intake";
import { revisionSummary } from "@/server/care/coordinator/compare";
import { RevisionPanel } from "@/components/coordinator/revision";
import { previewIntakeRota, rotaReadiness, staffingProposals } from "@/server/care/coordinator/rota";
import { INTAKE_STATUS } from "@/lib/care-coordinator-rules";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { cancelIntakeAction } from "@/app/coordinator-actions";
import { AppError } from "@/lib/errors";
import { Badge, Flash, PageHeader, SegmentNav } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";
import { SetupPanel } from "@/components/coordinator/setup-panel";
import { reportOf } from "@/server/care/coordinator/auto-setup";
import { countOpenExceptions, identityChoices, listExceptions } from "@/server/care/coordinator/exceptions";
import { DocumentsStep, HistoryStep, RotaStep, SourceFactsStep } from "@/components/coordinator/steps";

export const dynamic = "force-dynamic";

const STEPS = [
  ["setup", "Setup summary"],
  ["documents", "Documents"],
  ["facts", "Source facts"],
  ["rota", "Draft rota and carers"],
  ["history", "History"],
] as const;
type Step = (typeof STEPS)[number][0];

/** One intake: what CSB AI set up and anything that needs a person, the documents, the source facts (read-only), the draft rota. */
export default async function IntakePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("serviceUser.documents");
  const view = await orNotFound(getIntake(ctx, id));
  const { intake } = view;
  // Automatic setup (7 Nov 2026): the summary is the first screen; the fact review is a troubleshooting tool.
  const defaultStep: Step = !view.documents.length ? "documents" : "setup";
  // Links to the retired approval steps (fact review, Confirm & set up, manager approval) open the setup summary or
  // the read-only facts (owner's brief of 7 Nov 2026, "Remove redundant approval workflows").
  const asked = sp.step === "review" ? "facts" : sp.step === "approval" || sp.step === "save" ? "setup" : sp.step;
  const step = (STEPS.some(([k]) => k === asked) ? asked : defaultStep) as Step;
  const base = `/rota/coordinator/${intake.id}`;
  const back = `${base}?step=${step}${sp.section ? `&section=${sp.section}` : ""}`;
  const setup = step === "setup" ? { report: reportOf(intake.setupReport), ex: await listExceptions(ctx, { intakeId: intake.id }), identity: await identityChoices(ctx, intake.id) } : null;
  const attention = await countOpenExceptions(ctx, intake.id);

  const revision = step === "facts" && intake.mode === "EXISTING" ? await revisionSummary(ctx, intake.id) : null;
  let rota: { readiness: Awaited<ReturnType<typeof rotaReadiness>>; preview: Awaited<ReturnType<typeof previewIntakeRota>> | null; previewError: string | null; proposals: Awaited<ReturnType<typeof staffingProposals>> } | null = null;
  if (step === "rota") {
    const readiness = await rotaReadiness(ctx, intake.id);
    let preview = null;
    let previewError: string | null = null;
    if (sp.preview === "1") {
      try {
        preview = await previewIntakeRota(ctx, intake.id, sp.week || mondayOf(londonDate()), Number(sp.weeks || 2));
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        previewError = e.message;
      }
    }
    const proposals = readiness.serviceUser && readiness.active ? await staffingProposals(ctx, intake.id) : [];
    rota = { readiness, preview, previewError, proposals };
  }

  return (
    <>
      <PageHeader
        tabs={<RotaTabs ctx={ctx} ws="people" active="coordinator" />}
        title={`${intake.reference} · ${intake.title}`}
        back="/rota/coordinator"
        subtitle={<>{INTAKE_STATUS[intake.status as keyof typeof INTAKE_STATUS] ?? intake.status}. {view.person ? <>For {view.person.name} ({view.person.reference}). </> : intake.mode === "NEW" ? "A new person: they are created when Personal details are saved. " : null}Started by {view.createdBy}.{view.approvedBy ? ` Confirmed by ${view.approvedBy} (earlier process).` : ""} {intake.reader ? `Read by ${intake.reader === "basic-reader" ? "CSB's own reader (no AI)" : intake.reader}.` : ""}</>}
        actions={intake.status !== "COMPLETED" && intake.status !== "CANCELLED" ? (
          <details className="relative">
            <summary className="btn-secondary cursor-pointer list-none">Cancel intake</summary>
            <form action={cancelIntakeAction} className="absolute right-0 z-10 mt-1 w-[min(22rem,90vw)] space-y-2 rounded border border-slate-300 bg-white p-3 shadow">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="intakeId" value={intake.id} />
              <label className="block"><span className="label">Why it is being cancelled</span><input name="reason" required minLength={5} className="input" /></label>
              <p className="text-[12.5px] text-slate-600">Anything already saved to the person&apos;s record stays. Nothing more is saved from this intake.</p>
              <button className="btn-danger">Cancel intake</button>
            </form>
          </details>
        ) : <Badge>{INTAKE_STATUS[intake.status as keyof typeof INTAKE_STATUS]}</Badge>}
      />
      <Flash searchParams={sp} />
      <SegmentNav
        label="Intake steps"
        alert
        items={STEPS.map(([k, l]) => ({ href: `${base}?step=${k}`, label: k === "documents" ? `${l} (${view.documents.length})` : l, active: step === k, count: k === "setup" ? attention : undefined }))}
      />
      <div className="rounded-b-[3px] rounded-tr-[3px] bg-white px-[15px] pb-4 pt-3">
        {step === "setup" && setup ? <SetupPanel view={view} report={setup.report} exceptions={setup.ex.items} hidden={setup.ex.hidden} identity={setup.identity} back={back} /> : null}
        {step === "documents" ? <DocumentsStep view={view} back={back} /> : null}
        {step === "facts" && revision ? <RevisionPanel summary={revision} /> : null}
        {step === "facts" ? <SourceFactsStep view={view} section={sp.section} /> : null}
        {step === "rota" && rota ? <RotaStep view={view} back={back} rota={rota} week={sp.week || mondayOf(londonDate())} weeks={sp.weeks || "2"} lastWeek={addDays(mondayOf(londonDate()), 7 * 8)} /> : null}
        {step === "history" ? <HistoryStep view={view} /> : null}
      </div>
    </>
  );
}
