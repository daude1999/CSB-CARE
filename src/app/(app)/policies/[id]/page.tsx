import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { canOnPolicy, hasOrgPermission } from "@/server/auth/rbac";
import { getPolicy } from "@/server/policies/library";
import { newRevisionAction, rollbackAction, confirmImplementationAction } from "../../../actions";
import { DOC_TYPES } from "../../../../../prisma/seed-data/library/types";
import { Badge, Empty, Flash, fmtDate, SimulatedBadge, StatusBadge } from "@/components/ui";
import { Tab, TabList, TabPanel, Tabs } from "@/components/tabs";
import { Timeline, TimelineItem } from "@/components/timeline";
import { ActionDialog } from "@/components/dialog";
import { CaretRight, CheckCircle, FileDoc, FilePdf, PencilSimpleLine, Warning } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export default async function PolicyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const p = await orNotFound(getPolicy(ctx, id));
  const v = p.currentPublishedVersion;
  const canAuthor = canOnPolicy(ctx, p, "author");
  const back = `/policies/${p.id}`;
  // Organisation policies inherit requirement mappings from the template they were adopted from.
  const inherited = !p.requirementLinks.length && p.templateId;
  const links = inherited ? await db.requirementPolicyLink.findMany({ where: { policyId: p.templateId! }, include: { requirement: true } }) : p.requirementLinks;
  links.sort((a, b) => a.requirement.ref.localeCompare(b.requirement.ref));
  const owner = p.ownerId ? await db.user.findUnique({ where: { id: p.ownerId }, select: { name: true } }) : null;
  const typeName = new Map<string, string>(DOC_TYPES).get(p.docType) ?? p.docType;
  const now = new Date();
  const overdue = p.nextReviewDate && p.nextReviewDate < now;
  const flags = p.candidates.length;
  const byStatus = LEGAL_ORDER.map(([status, label]) => ({ label, items: links.filter((l) => l.requirement.legalStatus === status) })).filter((g) => g.items.length);
  const view = VIEWS.includes(sp.view ?? "") ? sp.view! : "document";
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-5 flex items-center gap-1.5 text-xs text-slate-500">
        <Link href={p.kind === "MASTER" ? "/policies?tab=templates" : "/policies"} className="text-slate-500 no-underline hover:text-navy-900">{p.kind === "MASTER" ? "CSB starter templates" : "Policies & Procedures"}</Link>
        <CaretRight size={11} aria-hidden="true" />
        <Link href={`/policies?category=${p.categoryCode}${p.kind === "MASTER" ? "&tab=templates" : ""}`} className="text-slate-500 no-underline hover:text-navy-900">{p.category.name}</Link>
      </nav>

      <header className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-3xl">
          <p className="eyebrow"><span className="text-navy-900">{p.ref}</span> · {typeName} · {p.kind === "MASTER" ? "CSB starter template" : "Organisation policy"}</p>
          <h1 className="mt-2 text-[2.4rem] leading-[1.1] tracking-[-0.02em]">{p.title}</h1>
          {p.description ? <p className="mt-3 max-w-2xl text-[15px] leading-6 text-slate-600">{p.description}</p> : null}
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <VersionLine version={v} />
            <span className={overdue ? "font-medium text-rose-700" : "text-slate-600"}>{overdue ? `Review overdue since ${fmtDate(p.nextReviewDate)}` : `Review by ${fmtDate(p.nextReviewDate)}`}</span>
            {p.revisions.some((r) => !r.closedAt) ? <Link href={`/revisions/${p.revisions.find((r) => !r.closedAt)!.id}`} className="text-sm">Revision in progress</Link> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {v ? (
            <>
              <a className="btn-secondary" href={`/api/policies/${p.id}/download?format=docx`} download data-testid="download-docx"><FileDoc size={16} aria-hidden="true" />Word</a>
              <a className="btn-secondary" href={`/api/policies/${p.id}/download?format=pdf`} download data-testid="download-pdf"><FilePdf size={16} aria-hidden="true" />PDF</a>
            </>
          ) : null}
          {canAuthor ? (
            <ActionDialog trigger={<><PencilSimpleLine size={16} aria-hidden="true" />Start revision</>} title={`Revise ${p.ref}`} description="A revision creates a draft copy of the current text. Nothing changes for staff until the draft is reviewed, approved and published.">
              <form action={newRevisionAction} className="space-y-4">
                <input type="hidden" name="policyId" value={p.id} />
                <input type="hidden" name="back" value={back} />
                <div>
                  <label className="label" htmlFor="revision-reason">Reason for revision</label>
                  <textarea className="input min-h-[88px]" id="revision-reason" name="reason" required placeholder="For example: annual review, or a change in local safeguarding procedures" />
                </div>
                <button className="btn-primary w-full" type="submit">Start revision</button>
              </form>
            </ActionDialog>
          ) : null}
        </div>
      </header>
      <Flash searchParams={sp} />

      <dl className="mb-8 grid grid-cols-2 border-y border-slate-300 sm:grid-cols-3 lg:grid-cols-6">
        <Control label="Version">{v ? v.label : "None published"}</Control>
        <Control label="Effective">{v ? fmtDate(v.effectiveDate) : "—"}</Control>
        <Control label="Review cycle">Every {p.reviewIntervalMonths} months</Control>
        <Control label="Owner">{owner?.name ?? "Not assigned"}</Control>
        <Control label="Applies to">{p.serviceTypes.length ? p.serviceTypes.map(serviceName).join(", ") : "All services"}</Control>
        <Control label={p.template ? "Based on" : "Jurisdiction"}>{p.template ? <Link href={`/policies/${p.template.id}`} className="font-mono text-[13px]">{p.template.ref}</Link> : p.jurisdiction === "ENG" ? "England" : p.jurisdiction}</Control>
      </dl>

      <Tabs defaultValue={view} label="Policy views">
        <TabList label="Policy views">
          <Tab value="document">Document</Tab>
          <Tab value="history" count={p.versions.length}>Version history</Tab>
          <Tab value="requirements" count={links.length}>Requirements</Tab>
          <Tab value="publications" count={p.publications.length}>Publication and reading</Tab>
          <Tab value="flags" count={flags}>Regulatory flags</Tab>
        </TabList>

        <TabPanel value="document">
          {v ? (
            <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
              <nav aria-label="Contents" className="hidden lg:block">
                <div className="sticky top-20">
                  <p className="eyebrow mb-3">Contents</p>
                  <ol className="space-y-px border-l border-slate-300 text-[13px]">
                    {v.sections.map((s, i) => (
                      <li key={s.key}><a href={`#${s.key}`} className="-ml-px flex gap-2 border-l-2 border-transparent py-1 pl-3 text-slate-600 no-underline hover:border-teal-400 hover:text-navy-900"><span className="w-4 shrink-0 font-mono text-[11px] leading-5 text-slate-400">{i + 1}</span>{s.heading}</a></li>
                    ))}
                  </ol>
                </div>
              </nav>
              <article className="min-w-0 rounded-sm border border-slate-200 bg-white shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-6 py-3 sm:px-12">
                  <span className="font-label text-[11px] uppercase tracking-[0.1em] text-slate-500">{p.ref} · {v.label} · effective {fmtDate(v.effectiveDate)}</span>
                  <SimulatedBadge show={v.isSimulated} />
                </div>
                {v.origin === "SEED" ? (
                  <div className="mx-6 mt-6 flex gap-3 border-l-2 border-amber-500 bg-amber-50/60 px-4 py-3 text-[13px] leading-5 text-amber-950 sm:mx-12">
                    <Warning size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
                    <span>This is CSB starter text. It has not been professionally reviewed and has no approval record here. Adapt it and take it through approval before staff rely on it.</span>
                  </div>
                ) : null}
                <div className="px-6 py-8 sm:px-12 sm:py-10">
                  <div className="mx-auto max-w-[68ch] space-y-9">
                    {v.sections.map((s, i) => (
                      <section key={s.key} id={s.key} className="scroll-mt-24">
                        <h2 className="flex items-baseline gap-3 text-[1.3rem]">
                          <span className="font-mono text-sm font-normal text-teal-600">{i + 1}</span>
                          {s.heading}
                          {s.isLocal ? <Badge tone="teal">local</Badge> : null}
                        </h2>
                        <p className="prose-policy mt-2.5 text-[16px] leading-[1.75]">{s.body}</p>
                      </section>
                    ))}
                  </div>
                </div>
              </article>
            </div>
          ) : (
            <Empty>This policy has not been published yet. See its open revisions under Version history.</Empty>
          )}
        </TabPanel>

        <TabPanel value="history">
          <p className="mb-6 max-w-2xl text-sm text-slate-600">Approved and published versions are never overwritten. Restoring an earlier version creates a new draft that must be approved again.</p>
          <Timeline testId="version-history">
            {p.versions.map((ver, i) => {
              const approvals = ver.approvals.filter((a) => a.decision === "APPROVE").length;
              const live = ver.status === "PUBLISHED";
              const draft = !["PUBLISHED", "SUPERSEDED", "ARCHIVED"].includes(ver.status);
              return (
                <TimelineItem
                  key={ver.id}
                  last={i === p.versions.length - 1}
                  mark={live ? "current" : draft ? "pending" : "past"}
                  when={fmtDate(ver.publishedAt ?? ver.createdAt)}
                  title={<span className="flex flex-wrap items-center gap-2"><Link href={`/policies/${p.id}/versions/${ver.id}`} className="font-serif text-[17px] text-navy-900">Version {ver.label}</Link><StatusBadge status={ver.status} /></span>}
                  aside={
                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      {ver.revisionAsDraft && draft ? <Link href={`/revisions/${ver.revisionAsDraft.id}`} className="btn-secondary px-2.5 py-1 text-xs">Open draft</Link> : null}
                      {canAuthor && ver.status === "SUPERSEDED" ? (
                        <form action={rollbackAction} className="flex gap-1">
                          <input type="hidden" name="policyId" value={p.id} />
                          <input type="hidden" name="versionId" value={ver.id} />
                          <input type="hidden" name="back" value={back} />
                          <input className="input w-36 py-1 text-xs" name="reason" placeholder="Reason" required aria-label="Rollback reason" />
                          <button className="btn-secondary px-2.5 py-1 text-xs" type="submit">Restore</button>
                        </form>
                      ) : null}
                    </div>
                  }
                >
                  <p>{ver.changeSummary ?? ver.reasonForChange ?? "No summary recorded."}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {ORIGIN[ver.origin] ?? ver.origin} · {approvals ? `${approvals} approval${approvals === 1 ? "" : "s"} recorded` : ver.origin === "SEED" ? "no approval record (starter text)" : "no approvals yet"}
                  </p>
                </TimelineItem>
              );
            })}
          </Timeline>
        </TabPanel>

        <TabPanel value="requirements">
          {links.length ? (
            <>
              <p className="mb-6 max-w-2xl text-sm text-slate-600">
                The legislation and guidance this document is written to meet{inherited ? <>, inherited from the CSB template <span className="font-mono">{p.template?.ref}</span></> : null}. A change to any of these sources is checked against this policy.
              </p>
              <div className="space-y-8">
                {byStatus.map((g) => (
                  <section key={g.label}>
                    <h3 className="eyebrow mb-2 font-sans">{g.label} <span className="text-slate-400">· {g.items.length}</span></h3>
                    <ul className="border-t-2 border-navy-900">
                      {g.items.map((l) => (
                        <li key={l.id} className="grid gap-x-5 gap-y-1 border-b border-slate-200 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
                          <Link href={`/requirements/${l.requirementId}`} className="whitespace-nowrap font-mono text-xs leading-6">{l.requirement.ref}</Link>
                          <div className="min-w-0">
                            <div className="text-sm text-navy-900">{l.requirement.title}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{l.requirement.exactReference} · {l.sectionKey ? <>covered in <a href={`#${l.sectionKey}`}>{v?.sections.find((s) => s.key === l.sectionKey)?.heading ?? l.sectionKey}</a></> : "covered by the whole policy"}</div>
                          </div>
                          <div className="text-xs sm:text-right"><Verification status={l.requirement.verificationStatus} /></div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <Empty>No requirements mapped to this document yet.</Empty>
          )}
        </TabPanel>

        <TabPanel value="publications">
          {p.publications.length ? (
            <ul className="border-t-2 border-navy-900">
              {p.publications.map((pub) => {
                const done = pub.acknowledgements.filter((a) => a.acknowledgedAt).length;
                const total = pub.acknowledgements.length;
                const pct = total ? Math.round((done / total) * 100) : 0;
                return (
                  <li key={pub.id} className="grid gap-x-8 gap-y-3 border-b border-slate-200 py-5 md:grid-cols-[minmax(0,1fr)_18rem]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={pub.status} /><span className="font-serif text-[17px] font-semibold text-navy-900">{pub.status === "SCHEDULED" ? "Scheduled for" : "Published"} {fmtDate(pub.publishedAt ?? pub.scheduledFor)}</span></div>
                      {pub.implementationConfirmedAt ? (
                        <p className="mt-2 flex items-start gap-1.5 text-sm text-emerald-800"><CheckCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />Implementation confirmed {fmtDate(pub.implementationConfirmedAt)}: {pub.implementationNotes}</p>
                      ) : pub.status === "PUBLISHED" && pub.organisationId && hasOrgPermission(ctx, "implementation.confirm") ? (
                        <form action={confirmImplementationAction} className="mt-3 flex max-w-lg gap-2">
                          <input type="hidden" name="publicationId" value={pub.id} />
                          <input type="hidden" name="back" value={back} />
                          <input className="input py-1.5 text-sm" name="notes" placeholder="How was it put into practice?" required aria-label="Implementation notes" />
                          <button className="btn-secondary shrink-0 py-1.5">Confirm implemented</button>
                        </form>
                      ) : null}
                    </div>
                    {pub.requiresAcknowledgement ? (
                      <div>
                        <div className="flex items-baseline justify-between text-xs text-slate-600"><span>Read and signed</span><span className="font-mono">{done} of {total}</span></div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Acknowledgements">
                          <div className={`h-full ${pct === 100 ? "bg-emerald-600" : "bg-teal-500"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ) : <p className="text-xs text-slate-500">No acknowledgement requested.</p>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>Not yet published.</Empty>
          )}
        </TabPanel>

        <TabPanel value="flags">
          {flags ? (
            <ul className="border-t-2 border-navy-900">
              {p.candidates.map((c) => (
                <li key={c.id} className="border-b border-slate-200 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/changes/${c.changeId}`} className="font-serif text-[16px] font-semibold text-navy-900">{c.change.title.replace(/^SIMULATED:\s*/, "")}</Link>
                    <SimulatedBadge show={c.change.isSimulated} />
                  </div>
                  <p className="mt-1 text-sm text-slate-600"><span className="text-slate-800">{c.reason.replace(/_/g, " ").toLowerCase().replace(/^./, (ch) => ch.toUpperCase())}.</span> {c.evidence.slice(0, 220)}{c.evidence.length > 220 ? "…" : ""}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No detected regulatory change has flagged this document.</Empty>
          )}
        </TabPanel>
      </Tabs>
    </>
  );
}

const VIEWS = ["document", "history", "requirements", "publications", "flags"];

const LEGAL_ORDER: [string, string][] = [
  ["LEGISLATION", "Legislation"],
  ["STATUTORY_GUIDANCE", "Statutory guidance"],
  ["REGULATOR_GUIDANCE", "Regulator guidance"],
  ["ADVISORY_GUIDANCE", "Advisory guidance"],
  ["BEST_PRACTICE", "Good practice"],
  ["INTERNAL_POLICY", "Internal policy"],
];

const ORIGIN: Record<string, string> = {
  SEED: "Starter text",
  MANUAL: "Manual revision",
  AI_REGULATORY_REVISION: "Revision prompted by a regulatory change",
  MASTER_SYNC: "Updated from the CSB template",
  ROLLBACK: "Restored from an earlier version",
};

const SERVICES: Record<string, string> = { RESIDENTIAL: "Residential", NURSING: "Nursing", DOMICILIARY: "Domiciliary", SUPPORTED_LIVING: "Supported living" };
function serviceName(code: string) {
  return SERVICES[code] ?? code.replace(/_/g, " ").toLowerCase();
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-slate-300 px-4 py-3.5 [&:not(:first-child)]:border-l max-sm:[&:nth-child(odd)]:border-l-0 max-sm:[&:nth-child(n+3)]:border-t sm:max-lg:[&:nth-child(3n+1)]:border-l-0 sm:max-lg:[&:nth-child(n+4)]:border-t">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm text-navy-900">{children}</dd>
    </div>
  );
}

function VersionLine({ version }: { version: { label: string; origin: string; publishedAt: Date | null } | null }) {
  if (!version) return <span className="flex items-center gap-1.5 text-amber-800"><span aria-hidden="true" className="h-2 w-2 rounded-full border-2 border-amber-600" />No published version</span>;
  if (version.origin === "SEED") return <span className="flex items-center gap-1.5 text-slate-700"><span aria-hidden="true" className="h-2 w-2 rounded-full border-2 border-slate-400" />Starter text {version.label}, not yet approved</span>;
  return <span className="flex items-center gap-1.5 text-emerald-800"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-600" />Approved {version.label}, published {fmtDate(version.publishedAt)}</span>;
}

function Verification({ status }: { status: string }) {
  if (status === "VERIFIED") return <span className="text-emerald-800">Checked against source</span>;
  if (status === "NEEDS_REVIEW") return <span className="font-medium text-rose-700">Needs review</span>;
  return <span className="text-amber-800">Not yet verified</span>;
}
