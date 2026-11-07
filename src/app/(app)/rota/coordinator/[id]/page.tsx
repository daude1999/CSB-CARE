import { requireRotaPage } from "@/server/auth/portals";
import { orNotFound } from "@/server/auth/page-guard";
import { getIntake } from "@/server/care/coordinator/intake";
import { revisionSummary } from "@/server/care/coordinator/compare";
import { RevisionPanel } from "@/components/coordinator/revision";
import { previewIntakeRota, rotaReadiness, staffingProposals } from "@/server/care/coordinator/rota";
import { INTAKE_STATUS, inReview } from "@/lib/care-coordinator-rules";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { cancelIntakeAction } from "@/app/coordinator-actions";
import { AppError } from "@/lib/errors";
import { Badge, Flash, PageHeader, SegmentNav } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";
import { DocumentsStep, HistoryStep, ReviewStep, RotaStep, SaveStep } from "@/components/coordinator/steps";

export const dynamic = "force-dynamic";

const STEPS = [
  ["documents", "1. Documents"],
  ["review", "2. Check facts"],
  ["save", "3. Confirm & set up"],
  ["rota", "4. Draft rota and carers"],
  ["history", "History"],
] as const;
type Step = (typeof STEPS)[number][0];

/** One intake, worked through in order: documents, the coordinator's check, Confirm & Set Up Records, the draft rota. */
export default async function IntakePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("serviceUser.documents");
  const view = await orNotFound(getIntake(ctx, id));
  const { intake } = view;
  const open = view.facts.filter((f) => f.decision === "PENDING" || f.decision === "CLARIFY").length;
  const defaultStep: Step = !view.documents.length ? "documents" : intake.status === "APPLYING" ? "save" : inReview(intake.status) ? (open ? "review" : "save") : "rota";
  // Old links to the retired manager approval step open Confirm & set up.
  const asked = sp.step === "approval" ? "save" : sp.step;
  const step = (STEPS.some(([k]) => k === asked) ? asked : defaultStep) as Step;
  const base = `/rota/coordinator/${intake.id}`;
  const back = `${base}?step=${step}${sp.section ? `&section=${sp.section}` : ""}${sp.show ? `&show=${sp.show}` : ""}`;
  const failed = view.sections.filter((s) => s.applyStatus === "FAILED").length;

  const revision = step === "review" && intake.mode === "EXISTING" ? await revisionSummary(ctx, intake.id) : null;
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
        subtitle={<>{INTAKE_STATUS[intake.status as keyof typeof INTAKE_STATUS] ?? intake.status}. {view.person ? <>For {view.person.name} ({view.person.reference}). </> : intake.mode === "NEW" ? "A new person: they are created when Personal details are saved. " : null}Started by {view.createdBy}.{view.approvedBy ? ` Confirmed by ${view.approvedBy}.` : ""} {intake.reader ? `Read by ${intake.reader === "basic-reader" ? "CSB's own reader (no AI)" : intake.reader}.` : ""}</>}
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
        items={STEPS.map(([k, l]) => ({ href: `${base}?step=${k}`, label: k === "documents" ? `${l} (${view.documents.length})` : l, active: step === k, count: k === "review" ? open : k === "save" ? failed : undefined }))}
      />
      <div className="rounded-b-[3px] rounded-tr-[3px] bg-white px-[15px] pb-4 pt-3">
        {step === "documents" ? <DocumentsStep view={view} back={back} /> : null}
        {step === "review" && revision ? <RevisionPanel intakeId={intake.id} summary={revision} back={back} open={intake.status === "DRAFT"} /> : null}
        {step === "review" ? <ReviewStep view={view} back={back} section={sp.section} show={sp.show} add={sp.add} /> : null}
        {step === "save" ? <SaveStep view={view} back={back} /> : null}
        {step === "rota" && rota ? <RotaStep view={view} back={back} rota={rota} week={sp.week || mondayOf(londonDate())} weeks={sp.weeks || "2"} lastWeek={addDays(mondayOf(londonDate()), 7 * 8)} /> : null}
        {step === "history" ? <HistoryStep view={view} /> : null}
      </div>
    </>
  );
}
