import { notFound } from "next/navigation";
import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { Panel } from "@/components/cqc-ui";
import { Flash } from "@/components/ui";
import { createRcaAction } from "@/app/cqc-actions";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { visibleBranches } from "@/server/cqc/common";
import { draftFromSource, RCA_CATEGORIES, rcaPeople, SEVERITIES, SOURCE_KINDS } from "@/server/cqc/rca";
import { londonDate } from "@/lib/london";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const PARAM: Record<string, keyof typeof SOURCE_KINDS> = { incident: "INCIDENT", missed: "MISSED_CALL", finding: "AUDIT_FINDING", risk: "RISK" };
const DUE_DAYS: Record<string, number> = { CRITICAL: 7, HIGH: 14, MODERATE: 28, LOW: 28 };

/**
 * Opens a new investigation, optionally from an existing record (?incident=, ?missed=, ?finding=, ?risk=). The record is
 * linked, not copied, and if an open investigation already covers it the page points there instead.
 */
export default async function NewRcaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!ctx.organisationId || !hasOrgPermission(ctx, "rca.create")) notFound();
  const param = Object.keys(PARAM).find((k) => sp[k]);
  let draft: Awaited<ReturnType<typeof draftFromSource>> | null = null;
  if (param) {
    try {
      draft = await draftFromSource(ctx, { type: PARAM[param]!, id: sp[param]! });
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }
  const [people, branches] = await Promise.all([rcaPeople(ctx), visibleBranches(ctx)]);
  const s = draft?.source ?? null;
  const today = londonDate();
  const severity = s?.severity && s.severity in SEVERITIES ? s.severity : "MODERATE";
  const due = new Date(Date.now() + (DUE_DAYS[severity] ?? 28) * 86_400_000).toISOString().slice(0, 10);
  const eventDate = s?.occurredAt ? londonDate(s.occurredAt) : today;
  const back = `/compliance/cqc/rca/new${param ? `?${param}=${sp[param]}` : ""}`;

  return (
    <>
      <CompliancePageHeader back="/compliance/cqc/rca" title="New RCA Investigation" subtitle="Record the basics now. The investigator then works through the seven steps on the investigation page." />
      <Flash searchParams={sp} />
      <div className="mx-auto max-w-[860px] space-y-4">
        {param && !s ? <p className="rounded-[10px] border border-[#fecdca] bg-[#fef3f2] px-4 py-2.5 text-[13.5px] text-[#b42318]" role="alert">That record could not be found, or you do not have access to it. You can still open an investigation without it.</p> : null}
        {draft?.existing ? (
          <p className="rounded-[10px] border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-[14px] text-[#93370d]" role="alert" data-testid="rca-duplicate">
            <strong>{draft.existing.reference}</strong> is already investigating {s?.ref}. Add to that investigation instead of starting another. <Link href={`/compliance/cqc/rca/${draft.existing.id}`} className="pc-link">Open {draft.existing.reference}</Link>
          </p>
        ) : null}
        <form action={createRcaAction} className="space-y-4" data-testid="new-rca">
          <input type="hidden" name="back" value={back} />
          {s ? <input type="hidden" name={s.type} value={s.id} /> : null}
          {s?.serviceUserId ? <input type="hidden" name="serviceUserId" value={s.serviceUserId} /> : null}
          {s ? (
            <Panel title="Investigating">
              <p className="px-5 py-3 text-[14px]"><strong>{SOURCE_KINDS[s.type]}</strong> {s.ref}. It stays as it is and keeps its own reference; the investigation links to it.</p>
            </Panel>
          ) : null}
          <Panel title="The event">
            <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-2">
              <label className="md:col-span-2"><span className="label">Title</span><input name="title" className="input" required minLength={5} maxLength={200} defaultValue={s ? `${s.category ?? "Event"}: ${s.ref}` : ""} placeholder="e.g. Late evening visits on the Riverside run" /></label>
              <label><span className="label">Category</span><select name="category" className="input" required defaultValue={s?.category ?? ""}><option value="" disabled>Choose…</option>{RCA_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <label><span className="label">Severity</span><select name="severity" className="input" required defaultValue={severity}>{Object.entries(SEVERITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label><span className="label">Date of the event</span><input type="date" name="eventDate" className="input" required max={today} defaultValue={eventDate} /></label>
              <label><span className="label">Time (optional)</span><input type="time" name="eventTime" className="input" /></label>
              <label><span className="label">Branch</span><select name="branchId" className="input" defaultValue={s?.branchId ?? ""}>{ctx.branchIds ? null : <option value="">Whole organisation</option>}{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label><span className="label">Other reference (optional)</span><input name="externalRef" className="input" placeholder="e.g. complaint or local authority reference" /></label>
            </div>
          </Panel>
          <Panel title="Who is responsible">
            <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-3">
              <label><span className="label">Investigator</span><select name="ownerId" className="input" required defaultValue=""><option value="" disabled>Choose…</option>{people.investigators.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label><span className="label">Responsible manager</span><select name="managerId" className="input" required defaultValue=""><option value="" disabled>Choose…</option>{people.managers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label><span className="label">Investigation due</span><input type="date" name="dueDate" className="input" required min={today} defaultValue={due} /></label>
              <p className="text-[12.5px] text-[#667085] md:col-span-3">The responsible manager reviews the findings, so choose someone other than the investigator. Suggested due date: 7 days for critical, 14 for high, 28 otherwise.</p>
            </div>
          </Panel>
          <Panel title="Confidentiality">
            <label className="flex items-start gap-3 px-5 py-4 text-[14px]">
              <input type="checkbox" name="restricted" className="mt-1" defaultChecked={s?.restricted || s?.category === "Safeguarding concern"} />
              <span><strong>Restricted (safeguarding or confidential)</strong><span className="block text-[13px] text-[#475467]">Only safeguarding leads and the people on this case will see its details. Safeguarding concerns are always restricted. Notifications never include personal details.</span></span>
            </label>
          </Panel>
          <div className="flex gap-2"><button className="pc-btn" type="submit">Open investigation</button><Link href="/compliance/cqc/rca" className="pc-btn-secondary">Cancel</Link></div>
        </form>
      </div>
    </>
  );
}
