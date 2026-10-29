import Link from "@/components/link";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Ctx } from "@/server/auth/rbac";
import { canOnPolicy, hasOrgPermission } from "@/server/auth/rbac";
import { DOC_TYPE_NAMES, inspectPolicy, libraryHref, type LibraryQuery, type PolicyInspection } from "@/server/policies/library-view";
import { adoptTemplateAction, archivePolicyAction, assignReviewerAction, logReadAndSignAction, newRevisionAction, restorePolicyAction } from "../../actions";
import { ActionDialog } from "@/components/dialog";
import { DocumentViewer } from "@/components/library/document-viewer";
import { InspectorTabs } from "@/components/library/inspector-tabs";
import { Menu } from "@/components/library/menu";
import { DocTile, fmtShort, relative, StatusPill } from "@/components/library/parts";
import { ArrowSquareOut, Archive, ArrowCounterClockwise, CheckCircle, ClockCounterClockwise, DotsThree, FileDoc, FilePdf, NotePencil, Signature, UserFocus, X } from "@phosphor-icons/react/dist/ssr";

const ORIGIN: Record<string, string> = {
  SEED: "CSB starter text",
  MANUAL: "Manual revision",
  AI_REGULATORY_REVISION: "Regulatory revision",
  MASTER_SYNC: "From CSB template",
  ROLLBACK: "Restored version",
};

/** The right-hand inspector: one policy, read without leaving the register. */
export async function PolicyInspector({ ctx, query, policyId }: { ctx: Ctx; query: LibraryQuery; policyId: string }) {
  let data: PolicyInspection;
  try {
    data = await inspectPolicy(ctx, policyId);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) return <InspectorMessage query={query} title="Policy not found" body="This policy doesn't exist, or you don't have access to it." />;
    if (!(e instanceof AppError)) logger.error({ err: (e as Error).message }, "policy inspector failed");
    return <InspectorMessage query={query} title="This policy couldn't be loaded" body="Something went wrong while loading it. Try again in a moment." />;
  }
  const p = data.policy;
  const v = data.version;
  const close = libraryHref(query, { selected: undefined, pane: undefined });
  const back = libraryHref(query, { selected: p.id });
  const active = p.status === "ACTIVE";
  const isTemplate = p.kind === "MASTER";
  const canRevise = active && canOnPolicy(ctx, p, "author");
  const canAssign = active && !isTemplate && hasOrgPermission(ctx, "policy.author") && data.reviewers.length > 0;
  const canArchive = !isTemplate && hasOrgPermission(ctx, "org.manage");
  const canAdopt = isTemplate && hasOrgPermission(ctx, "policy.author");
  const typeName = DOC_TYPE_NAMES.get(p.docType) ?? p.docType;
  const category = data.area ? `${data.area.label} › ${p.category.name}` : p.category.name;
  const pdfHref = `/api/policies/${p.id}/download?format=pdf`;
  const approval = data.openRevision?.submitted ? "Awaiting approval" : data.approvals.length ? "Approved" : v ? "Not yet approved" : "Draft";

  const panes = [
    {
      value: "document",
      label: "Document",
      content: v ? (
        <div className="px-[14px] pt-[16px]">
          <DocumentViewer src={`${pdfHref}&disposition=inline`} downloadHref={pdfHref} title={p.title} headings={v.sections.filter((s) => s.key !== "framework" && s.key !== "related").map((s) => s.heading)} />
          <p className="mt-2 text-[12px] text-[#646e7f]">
            {v.origin === "SEED" ? "CSB starter text, not yet approved by your organisation. " : ""}
            <Link href={`/policies/${p.id}?view=text`}>Read as accessible text</Link>
          </p>
        </div>
      ) : (
        <EmptyPane>
          This policy has no published version yet.
          {data.openRevision ? <> The draft is in <Link href={`/revisions/${data.openRevision.id}`}>{data.openRevision.title}</Link>.</> : null}
        </EmptyPane>
      ),
    },
    {
      value: "overview",
      label: "Overview",
      content: (
        <div className="space-y-4 px-[20px] py-[18px]">
          <p className="text-[13.5px] leading-6 text-[#2f3d52]">{p.description}</p>
          <dl className="pl-dl">
            <dt>Type</dt><dd>{typeName}</dd>
            <dt>Category</dt><dd>{category}</dd>
            <dt>Services</dt><dd>{data.services.length ? data.services.map((s) => s.name).join(", ") : "Not specified"}</dd>
            <dt>Owner</dt><dd>{data.owner ?? "Not recorded"}</dd>
            <dt>Reviewer</dt><dd>{data.reviewer ?? "Not assigned"}</dd>
            <dt>Review cycle</dt><dd>At least every {p.reviewIntervalMonths} months</dd>
            <dt>Next review</dt><dd>{p.nextReviewDate ? `${fmtShort(p.nextReviewDate)} (${relative(p.nextReviewDate)})` : "Not scheduled"}</dd>
            {data.template ? <><dt>Based on</dt><dd><Link href={`/policies/${data.template.id}`}>{data.template.ref} {data.template.title}</Link></dd></> : null}
            {data.openRevision ? <><dt>In progress</dt><dd><Link href={`/revisions/${data.openRevision.id}`}>{data.openRevision.title}</Link>{data.openRevision.submitted ? " (submitted for review)" : " (draft)"}</dd></> : null}
          </dl>
        </div>
      ),
    },
    {
      value: "history",
      label: "History",
      content: data.history.length ? (
        <ol className="divide-y divide-[#efece6] px-[20px] py-[8px]" data-testid="inspector-history">
          {data.history.map((h) => (
            <li key={h.id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <Link href={`/policies/${p.id}/versions/${h.id}`} className="font-semibold text-[#0b1530] hover:text-[#0646b1]">Version {h.label.replace(/^v/i, "")}</Link>
                <span className="text-[12.5px] text-[#646e7f]">{fmtShort(h.publishedAt)} · {ORIGIN[h.origin] ?? h.origin}{h.status === "PUBLISHED" ? " · current" : ""}</span>
              </div>
              {h.changeSummary ? <p className="mt-1 text-[13px] text-[#2f3d52]">{h.changeSummary}</p> : null}
              <p className="mt-1 text-[12.5px] text-[#646e7f]">{h.approvers.length ? `Approved by ${h.approvers.join(", ")}` : "No approval record"}</p>
            </li>
          ))}
        </ol>
      ) : <EmptyPane>No version has been published yet.</EmptyPane>,
    },
    {
      value: "signoff",
      label: "Sign-off",
      content: <SignOffPane data={data} back={`${back}&pane=signoff`} />,
    },
    {
      value: "linked",
      label: "Linked Items",
      content: <LinkedPane data={data} query={query} />,
    },
  ];

  return (
    <section aria-label={`Policy: ${p.title}`} className="pl-panel flex flex-col bg-white" data-testid="policy-inspector">
      <header className="flex items-start gap-4 px-[18px] pb-[14px] pt-[16px]">
        <DocTile status={data.status} size={56} />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="pl-serif truncate text-[20px] font-semibold leading-7 text-[#0b1530]">{p.title}</h2>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#4a5564]">
            <span>{p.ref}</span>
            <StatusPill status={data.status} />
            {v ? <span>Version {v.label.replace(/^v/i, "")}</span> : null}
            {!active ? <span className="font-medium text-[#b42318]">Archived</span> : null}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link href={close} scroll={false} aria-label="Close policy" title="Close" className="pl-icon-btn"><X size={17} /></Link>
          <Menu label="More actions" trigger={<DotsThree size={20} weight="bold" />} className="rounded-[6px] border border-[#e3e0d9]">
            <Link href={`/policies/${p.id}`} className="pl-menu-item"><ArrowSquareOut size={15} />Open full record</Link>
            {v ? <a href={`/api/policies/${p.id}/download?format=docx`} download className="pl-menu-item"><FileDoc size={15} />Download Word</a> : null}
            {v ? <a href={pdfHref} download className="pl-menu-item"><FilePdf size={15} />Download PDF</a> : null}
          </Menu>
        </div>
      </header>

      <InspectorTabs key={`${p.id}:${query.pane}`} value={query.pane} panes={panes} />

      <div className="mx-[14px] mt-[14px] rounded-[8px] border border-[#ebe8e2] px-[16px] py-[14px]">
        <h3 className="mb-3 text-[14.5px] font-semibold text-[#0b1530]">Key Information</h3>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-[9px] text-[12px] sm:grid-cols-2" data-testid="key-information">
          <KeyRow label="Owner" value={data.owner ?? "Not recorded"} />
          <KeyRow label="Next Review" value={p.nextReviewDate ? `${fmtShort(p.nextReviewDate)} (${relative(p.nextReviewDate)})` : "Not scheduled"} />
          <KeyRow label="Category" value={<span title={category}>{p.category.name}</span>} />
          <KeyRow label="Approval" value={<span className={`whitespace-nowrap rounded-[4px] px-1.5 py-px ${approval === "Approved" ? "bg-[#d6fcee] text-[#157a3e]" : approval === "Awaiting approval" ? "bg-[#e4f0fe] text-[#0454d8]" : "bg-[#eef0f3] text-[#4a5564]"}`}>{approval}</span>} />
          <KeyRow label="Last Updated" value={fmtShort(v?.publishedAt ?? p.updatedAt)} />
          <KeyRow label="Applicable To" value={data.services.length ? data.services.map((s) => s.name).join(", ") : "All services"} />
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-[14px] pb-[14px] pt-[14px]">
        {canAssign ? (
          <ActionDialog triggerClassName="pl-btn-primary" trigger={<><UserFocus size={16} aria-hidden="true" />Assign for Review</>} title={`Assign ${p.ref} for review`} description="The reviewer is named on the policy and notified. It doesn't start a revision.">
            <form action={assignReviewerAction} className="space-y-4">
              <input type="hidden" name="policyId" value={p.id} />
              <input type="hidden" name="back" value={back} />
              <div>
                <label className="label" htmlFor="reviewerId">Reviewer</label>
                <select className="input" id="reviewerId" name="reviewerId" required defaultValue={p.reviewerId ?? ""}>
                  <option value="" disabled>Choose a reviewer</option>
                  {data.reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <button className="btn-primary w-full" type="submit">Assign and notify</button>
            </form>
          </ActionDialog>
        ) : null}
        {canAdopt ? (
          <form action={adoptTemplateAction}>
            <input type="hidden" name="templateId" value={p.id} />
            <input type="hidden" name="back" value={back} />
            <button className="pl-btn-primary" type="submit">Adopt template</button>
          </form>
        ) : null}
        {canRevise ? (
          data.openRevision ? (
            <Link href={`/revisions/${data.openRevision.id}`} className="pl-btn-secondary"><NotePencil size={16} aria-hidden="true" />Open revision</Link>
          ) : (
            <ActionDialog triggerClassName="pl-btn-secondary" trigger={<><NotePencil size={16} aria-hidden="true" />Create Revision</>} title={`Revise ${p.ref}`} description="A revision creates a draft copy of the current text. Nothing changes for staff until the draft is reviewed, approved and published.">
              <form action={newRevisionAction} className="space-y-4">
                <input type="hidden" name="policyId" value={p.id} />
                <input type="hidden" name="back" value={back} />
                <div>
                  <label className="label" htmlFor="inspector-revision-reason">Reason for revision</label>
                  <textarea className="input min-h-[88px]" id="inspector-revision-reason" name="reason" required placeholder="For example: annual review, or a change in local procedures" />
                </div>
                <button className="btn-primary w-full" type="submit">Create revision</button>
              </form>
            </ActionDialog>
          )
        ) : null}
        {!isTemplate && active ? <Link href={libraryHref(query, { selected: p.id, pane: "signoff" })} scroll={false} className="pl-btn-secondary"><Signature size={16} aria-hidden="true" />Manage Sign-off</Link> : null}
        {!active && canArchive ? (
          <ActionDialog triggerClassName="pl-btn-primary" trigger={<><ArrowCounterClockwise size={16} aria-hidden="true" />Restore</>} title={`Restore ${p.ref}`} description="The policy returns to your library with its versions unchanged.">
            <ReasonForm action={restorePolicyAction} policyId={p.id} back={back} button="Restore policy" />
          </ActionDialog>
        ) : null}
        <Menu label="More policy actions" trigger={<DotsThree size={20} weight="bold" />} className="rounded-[6px] border border-[#dcd9d2] bg-white" align="right">
          <Link href={`/policies/${p.id}`} className="pl-menu-item"><ArrowSquareOut size={15} />Open full record</Link>
          <Link href={`/policies/${p.id}?view=history`} className="pl-menu-item"><ClockCounterClockwise size={15} />Versions and rollback</Link>
          {active && canArchive ? (
            <ActionDialog triggerClassName="pl-menu-item" trigger={<><Archive size={15} aria-hidden="true" />Archive policy</>} title={`Archive ${p.ref}`} description="Archived policies leave your library but keep every version and record. You can restore it later.">
              <ReasonForm action={archivePolicyAction} policyId={p.id} back={back} button="Archive policy" />
            </ActionDialog>
          ) : null}
        </Menu>
      </div>
    </section>
  );
}

function ReasonForm({ action, policyId, back, button }: { action: (fd: FormData) => Promise<void>; policyId: string; back: string; button: string }) {
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="policyId" value={policyId} />
      <input type="hidden" name="back" value={back} />
      <div>
        <label className="label" htmlFor={`reason-${button.toLowerCase().replace(/\s+/g, "-")}`}>Reason</label>
        <textarea className="input min-h-[80px]" id={`reason-${button.toLowerCase().replace(/\s+/g, "-")}`} name="reason" required minLength={5} />
      </div>
      <button className="btn-primary w-full" type="submit">{button}</button>
    </form>
  );
}

function KeyRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-2">
      <dt className="text-[#646e7f]">{label}</dt>
      <dd className="min-w-0 text-[#2f3d52]">{value}</dd>
    </div>
  );
}

function EmptyPane({ children }: { children: React.ReactNode }) {
  return <p className="mx-[20px] my-[24px] rounded-[8px] border border-dashed border-[#dcd9d2] px-4 py-6 text-center text-[13px] text-[#4a5564]">{children}</p>;
}

function SignOffPane({ data, back }: { data: PolicyInspection; back: string }) {
  const s = data.signOff;
  if (!s) return <EmptyPane>This policy hasn&apos;t been published to staff yet, so there is nothing to sign.</EmptyPane>;
  return (
    <div className="space-y-4 px-[20px] py-[18px]" data-testid="inspector-signoff">
      <p className="text-[13px] text-[#4a5564]">Published {fmtShort(s.publishedAt)}{s.dueAt ? `, sign by ${fmtShort(s.dueAt)}` : ""}.</p>
      {s.own?.acknowledgedAt ? (
        <p className="flex items-center gap-2 text-[13px] font-medium text-[#157a3e]"><CheckCircle size={16} weight="fill" aria-hidden="true" />You read and signed this on {fmtShort(s.own.acknowledgedAt)}</p>
      ) : data.policy.organisationId ? (
        <form action={logReadAndSignAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="policyId" value={data.policy.id} />
          <input type="hidden" name="back" value={back} />
          <span className="text-[13px] text-[#4a5564]">You haven&apos;t signed this version yet.</span>
          <button type="submit" className="pl-btn-primary"><Signature size={16} aria-hidden="true" />Log Read &amp; Sign</button>
        </form>
      ) : null}
      {s.coverage ? (
        <div>
          <p className="text-[13px] text-[#2f3d52]"><strong className="font-semibold">{s.coverage.signed}</strong> of {s.coverage.assigned} signed · {s.coverage.outstanding} outstanding{s.coverage.overdue ? <> · <span className="text-[#b42318]">{s.coverage.overdue} overdue</span></> : null}</p>
          <ul className="mt-2 max-h-[180px] divide-y divide-[#efece6] overflow-y-auto rounded-[6px] border border-[#ebe8e2] text-[12.5px]">
            {s.coverage.people.map((person, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span>{person.name}</span>
                <span className={person.acknowledgedAt ? "text-[#157a3e]" : person.dueAt && person.dueAt < new Date() ? "text-[#b42318]" : "text-[#646e7f]"}>{person.acknowledgedAt ? `Signed ${fmtShort(person.acknowledgedAt)}` : person.dueAt ? `Due ${fmtShort(person.dueAt)}` : "Not signed"}</span>
              </li>
            ))}
          </ul>
          <Link href="/staff" className="mt-2 inline-block text-[12.5px]">Open Staff Sign-off</Link>
        </div>
      ) : null}
    </div>
  );
}

function LinkedPane({ data, query }: { data: PolicyInspection; query: LibraryQuery }) {
  const l = data.linked;
  const empty = !l.requirements.length && !l.changes.length && !l.assessments.length && !l.related.length && !data.template;
  if (empty) return <EmptyPane>Nothing is linked to this policy yet.</EmptyPane>;
  return (
    <div className="max-h-[420px] space-y-4 overflow-y-auto px-[20px] py-[16px] text-[13px]" data-testid="inspector-linked">
      {l.requirements.length ? (
        <LinkGroup title={`Regulatory requirements (${l.requirements.length})`} note={l.inherited ? "Mapped on the CSB template this policy is based on." : undefined}>
          {l.requirements.map((r) => <li key={r.id}><Link href={`/requirements/${r.id}`}>{r.ref}</Link> <span className="text-[#4a5564]">{r.title}</span></li>)}
        </LinkGroup>
      ) : null}
      {l.changes.length ? (
        <LinkGroup title="Regulatory changes that flagged it">
          {l.changes.map((c, i) => <li key={`${c.id}-${i}`}><Link href={`/changes/${c.id}`}>{c.title}</Link> <span className="text-[#646e7f]">{fmtShort(c.at)}</span></li>)}
        </LinkGroup>
      ) : null}
      {l.assessments.length ? (
        <LinkGroup title="Impact assessments">
          {l.assessments.map((a) => <li key={a.id}><Link href={`/changes/${a.change.id}`}>{a.change.title}</Link> <span className="text-[#646e7f]">{a.outcome.replaceAll("_", " ").toLowerCase()} · {a.urgency.toLowerCase()} urgency{a.isSimulated ? " · simulated" : ""}</span></li>)}
        </LinkGroup>
      ) : null}
      {l.related.length ? (
        <LinkGroup title="Related documents">
          {l.related.map((r) => <li key={r.id}><Link href={libraryHref(query, { selected: r.id, pane: undefined })} scroll={false}>{r.ref}</Link> <span className="text-[#4a5564]">{r.title}</span> <span className="text-[#646e7f]">· {DOC_TYPE_NAMES.get(r.docType) ?? r.docType}</span></li>)}
        </LinkGroup>
      ) : null}
      {data.template ? (
        <LinkGroup title="CSB template">
          <li><Link href={`/policies/${data.template.id}`}>{data.template.ref}</Link> <span className="text-[#4a5564]">{data.template.title}</span></li>
        </LinkGroup>
      ) : null}
    </div>
  );
}

function LinkGroup({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-[12.5px] font-semibold uppercase tracking-[0.04em] text-[#646e7f]">{title}</h4>
      {note ? <p className="mb-1.5 text-[12px] text-[#646e7f]">{note}</p> : null}
      <ul className="space-y-1">{children}</ul>
    </section>
  );
}

function InspectorMessage({ query, title, body }: { query: LibraryQuery; title: string; body: string }) {
  return (
    <section aria-label="Policy" className="pl-panel bg-white px-6 py-10 text-center" data-testid="policy-inspector">
      <h2 className="pl-serif text-[19px] font-semibold text-[#0b1530]">{title}</h2>
      <p className="mt-2 text-[13px] text-[#4a5564]">{body}</p>
      <Link href={libraryHref(query, { selected: undefined, pane: undefined })} scroll={false} className="pl-btn-secondary mt-4">Back to the list</Link>
    </section>
  );
}
