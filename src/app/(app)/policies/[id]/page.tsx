import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { markOpened } from "@/server/policies/assignment";
import { canOnPolicy, hasOrgPermission } from "@/server/auth/rbac";
import { getPolicy } from "@/server/policies/library";
import { newRevisionAction, rollbackAction, confirmImplementationAction, logReadAndSignAction } from "../../../actions";
import { DOC_TYPES } from "../../../../../prisma/seed-data/library/types";
import { Badge, Empty, Flash, fmtDate, SimulatedBadge, StatusBadge } from "@/components/ui";
import { TabPanel, Tabs, TileTab, TileTabList } from "@/components/tabs";
import { TitleBar } from "@/components/title-bar";
import { TagBody, TagText } from "@/components/tag-text";
import { businessDetails } from "@/server/business";
import { missingDetails, personaliseSections } from "@/lib/business";
import { Timeline, TimelineItem } from "@/components/timeline";
import { ActionDialog } from "@/components/dialog";
import { ArrowSquareOut, ArrowsClockwise, Books, CalendarBlank, CalendarCheck, CaretRight, CheckCircle, ClockCounterClockwise, EnvelopeSimple, FileDoc, FilePdf, FileText, Flag, Lightbulb, ListChecks, Notepad, Paperclip, PencilSimpleLine, Scales, Signature, Tag, Warning } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export default async function PolicyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const p = await orNotFound(getPolicy(ctx, id));
  // The first open of an outstanding reading assignment is recorded (opening is not acknowledgement).
  await markOpened(ctx, p.id);
  const v = p.currentPublishedVersion;
  const canAuthor = canOnPolicy(ctx, p, "author");
  const back = `/policies/${p.id}`;
  // Organisation policies inherit requirement mappings from the template they were adopted from.
  const inherited = !p.requirementLinks.length && p.templateId;
  const links = inherited ? await db.requirementPolicyLink.findMany({ where: { policyId: p.templateId! }, include: { requirement: true } }) : p.requirementLinks;
  links.sort((a, b) => a.requirement.ref.localeCompare(b.requirement.ref));
  const typeName = new Map<string, string>(DOC_TYPES).get(p.docType) ?? p.docType;
  const isPolicy = ["POLICY", "PROCEDURE", "GUIDANCE"].includes(p.docType);
  const now = new Date();
  const overdue = p.nextReviewDate && p.nextReviewDate < now;
  const flags = p.candidates.length;
  const byStatus = LEGAL_ORDER.map(([status, label]) => ({ label, items: links.filter((l) => l.requirement.legalStatus === status) })).filter((g) => g.items.length);

  const published = v ? p.versions.find((x) => x.id === v.id) : undefined;
  const approvals = published?.approvals.filter((a) => a.decision === "APPROVE") ?? [];
  const relatedRefs = [...(v?.sections.find((s) => s.key === "related")?.body.matchAll(/CSB-[A-Z]+-\d+/g) ?? [])].map((m) => m[0]);
  const [details, people, impact, forms, related] = await Promise.all([
    p.organisationId ? businessDetails(p.organisationId) : null,
    db.user.findMany({ where: { id: { in: [...approvals.map((a) => a.deciderId), p.ownerId, p.reviewerId, p.approverId].filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
    db.impactAssessment.findFirst({ where: { policyId: { in: [p.id, ...(p.templateId ? [p.templateId] : [])] } }, orderBy: { createdAt: "desc" }, select: { urgency: true } }),
    // Forms, templates, checklists and tools that name this policy as their parent.
    db.policy.findMany({
      where: { organisationId: p.organisationId, status: "ACTIVE", docType: { notIn: ["POLICY", "PROCEDURE", "GUIDANCE"] }, id: { not: p.id }, currentPublishedVersion: { sections: { some: { key: "related", body: { contains: p.ref } } } } },
      orderBy: { ref: "asc" },
      select: { id: true, ref: true, title: true, docType: true, description: true, currentPublishedVersion: { select: { label: true } } },
    }),
    relatedRefs.length ? db.policy.findMany({ where: { organisationId: p.organisationId, ref: { in: relatedRefs } }, select: { id: true, ref: true, title: true, docType: true } }) : [],
  ]);
  const person = new Map(people.map((u) => [u.id, u.name]));
  // Organisation policies carry the organisation's details; CSB templates stay generic.
  const sections = v ? (p.organisationId ? personaliseSections(v.sections, p.docType) : v.sections) : [];
  const procedure = sections.filter((s) => s.key.startsWith("procedure."));
  const definitions = sections.find((s) => s.key === "definitions");
  const textSections = sections.filter((s) => !s.key.startsWith("procedure.") && s.key !== "definitions" && s.key !== "related" && s.key !== "framework");
  const framework = parseFramework(sections.find((s) => s.key === "framework")?.body);
  const reading = [...new Map(links.filter((l) => l.requirement.sourceUrl && !l.requirement.isSimulated).map((l) => [l.requirement.sourceUrl, l.requirement])).values()];
  const missing = details ? missingDetails(details) : [];

  const latestPub = p.publications.find((x) => x.status === "PUBLISHED");
  const myAck = latestPub?.acknowledgements.find((a) => a.userId === ctx.userId);
  const lastChanged = p.versions.find((x) => x.status === "PUBLISHED" || x.status === "SUPERSEDED");
  const level = impact?.urgency === "URGENT" || impact?.urgency === "HIGH" ? 3 : impact?.urgency === "MEDIUM" ? 2 : 1;

  const tabs = [
    { value: "review", label: "Review Sheet", icon: <Notepad size={30} /> },
    ...(v ? [{ value: "text", label: isPolicy ? "Policy Text" : `${typeName} Text`, icon: <FileText size={30} /> }] : []),
    ...(procedure.length || definitions ? [{ value: "procedure", label: "Procedure", icon: <ListChecks size={30} /> }] : []),
    { value: "forms", label: isPolicy ? "Forms" : "Related", icon: <Paperclip size={30} />, count: undefined as number | undefined },
    ...(v ? [{ value: "document", label: "All Policy", icon: <Books size={30} /> }] : []),
    { value: "history", label: "Versions", icon: <ClockCounterClockwise size={30} /> },
    { value: "requirements", label: "Regulation Map", icon: <Scales size={30} /> },
    { value: "publications", label: "Read & Sign", icon: <Signature size={30} /> },
    { value: "flags", label: "Reg. Flags", icon: <Flag size={30} />, count: flags || undefined },
  ];
  const view = tabs.some((t) => t.value === sp.view) ? sp.view! : sp.view === "document" && v ? "document" : "review";

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <Link href={p.kind === "MASTER" ? "/policies?tab=templates" : "/policies"} className="text-slate-500 no-underline hover:text-navy-900">{p.kind === "MASTER" ? "CSB template library" : "My Policies"}</Link>
        <CaretRight size={11} aria-hidden="true" />
        <Link href={`/policies?category=${p.categoryCode}${p.kind === "MASTER" ? "&tab=templates" : ""}`} className="text-slate-500 no-underline hover:text-navy-900">{p.category.name}</Link>
      </nav>

      {details && missing.length && isPolicy ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4 border-[#a3242c] bg-white px-4 py-2.5 text-[14px] text-[#a3242c] shadow-[0_0_0_1px_#eef1f3]">
          <span className="min-w-0 flex-1">Your business details are incomplete, so parts of this policy are not yet personalised to your organisation.</span>
          <Link href="/settings#business" className="rounded-[4px] bg-navy-900 px-4 py-1.5 text-[14px] text-white no-underline hover:bg-navy-700 hover:text-white">Complete details</Link>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {[p.category.name, typeName, p.kind === "MASTER" ? "CSB template" : "Our policy"].map((t) => (
            <span key={t} className="flex items-center gap-1.5 rounded-[4px] border border-slate-400 bg-white px-2.5 py-1 text-[13px] text-slate-800"><Tag size={14} aria-hidden="true" />{t}</span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {v ? (
            <>
              <a className="btn-secondary" href={`/api/policies/${p.id}/download?format=docx`} download data-testid="download-docx"><FileDoc size={16} aria-hidden="true" />Download Word</a>
              <a className="btn-secondary" href={`/api/policies/${p.id}/download?format=pdf`} download data-testid="download-pdf"><FilePdf size={16} aria-hidden="true" />Download PDF</a>
            </>
          ) : null}
          {latestPub && ctx.organisationId ? (
            myAck?.acknowledgedAt ? (
              <span className="flex items-center gap-1.5 rounded-[4px] border border-emerald-300 bg-emerald-50 px-3 py-[7px] text-[13px] font-medium text-emerald-800" data-testid="signed-state"><CheckCircle size={16} weight="fill" aria-hidden="true" />Read &amp; signed {fmtDate(myAck.acknowledgedAt)}</span>
            ) : (
              <form action={logReadAndSignAction}>
                <input type="hidden" name="policyId" value={p.id} />
                <input type="hidden" name="back" value={`${back}?view=${view}`} />
                <button className="btn-primary" type="submit" data-testid="log-read-sign"><Signature size={16} aria-hidden="true" />Log Read &amp; Sign</button>
              </form>
            )
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
      </div>

      <TitleBar title={<>{p.ref.replace(/^CSB-/, "")} – {p.title}</>} />
      <p className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 bg-white px-4 py-2 text-[13px] shadow-[0_0_0_1px_#eef1f3]">
        <VersionLine version={v} />
        <span className={overdue ? "font-medium text-rose-700" : "text-slate-600"}>{overdue ? `Review overdue since ${fmtDate(p.nextReviewDate)}` : `Next review ${fmtDate(p.nextReviewDate)}`}</span>
        {p.revisions.some((r) => !r.closedAt) ? <Link href={`/revisions/${p.revisions.find((r) => !r.closedAt)!.id}`}>Revision in progress</Link> : null}
      </p>
      <Flash searchParams={sp} />

      <Tabs defaultValue={view} label="Policy views">
        <div className="mt-3">
          <TileTabList label="Policy views">
            {tabs.map((t) => <TileTab key={t.value} value={t.value} icon={t.icon} count={t.count}>{t.label}</TileTab>)}
          </TileTabList>
        </div>

        <TabPanel value="review">
          <section aria-label="Review sheet" className="overflow-hidden rounded-[3px] bg-white shadow-[0_0_0_1px_#eef1f3]">
            <h2 className="bg-teal-100 px-5 py-3 text-[18px] font-medium tracking-normal text-navy-900">Review Sheet</h2>
            <div className="flex flex-wrap gap-x-10 gap-y-2 border-b border-slate-200 px-5 py-3 text-[14px] text-slate-700">
              <span className="flex items-center gap-2"><CalendarCheck size={18} className="text-teal-600" aria-hidden="true" />Last reviewed <strong className="font-medium text-slate-900">{fmtDate(v?.publishedAt ?? v?.effectiveDate)}</strong></span>
              <span className="flex items-center gap-2"><CalendarBlank size={18} className="text-teal-600" aria-hidden="true" />Last amended <strong className="font-medium text-slate-900">{fmtDate(lastChanged?.publishedAt ?? lastChanged?.createdAt)}</strong></span>
              <span className="flex items-center gap-2"><ArrowsClockwise size={18} className="text-teal-600" aria-hidden="true" />Reviewed when needs change, and at least: <strong className="font-medium text-slate-900">{p.reviewIntervalMonths === 12 ? "Annually" : `Every ${p.reviewIntervalMonths} months`}</strong></span>
            </div>
            <dl className="text-[14px] [&>div:nth-child(even)]:bg-[#f5f9fc]">
              <SheetRow label="Business impact">
                <span className="flex items-center gap-4">
                  <span className="flex flex-col items-center"><ImpactBars level={level} /><span className={`mt-0.5 text-[11px] font-bold uppercase ${level === 3 ? "text-rose-700" : level === 2 ? "text-[#c3332c]" : "text-emerald-700"}`}>{["Low", "Medium", "High"][level - 1]}</span></span>
                  <span>{IMPACT_TEXT[level - 1]}</span>
                </span>
              </SheetRow>
              <SheetRow label="Reason for this review">{v?.origin === "SEED" ? "Adopted from the CSB starter library; due for your first local review" : published?.reasonForChange ?? "Scheduled review"}</SheetRow>
              <SheetRow label="Changes made">{v && v.versionNumber > 1 ? "Yes" : "No, first issue"}</SheetRow>
              <SheetRow label="Summary">{published?.changeSummary ?? p.description}</SheetRow>
              {framework.legal.length ? <SheetRow label="CQC regulations and legislation"><ul className="ml-5 list-disc space-y-1 marker:text-teal-500">{framework.legal.map((l) => <li key={l}>{l}</li>)}</ul></SheetRow> : null}
              {framework.qs.length ? (
                <SheetRow label="CQC quality statements">
                  <ul className="flex flex-wrap gap-2">{framework.qs.map((q) => { const [kq, title] = q.split(/:\s*/, 2); return <li key={q} className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[13px] text-navy-900"><strong className="font-semibold">{kq}</strong> · {title}</li>; })}</ul>
                </SheetRow>
              ) : null}
              {framework.guidance.length ? <SheetRow label="Guidance it reflects"><ul className="ml-5 list-disc space-y-1 marker:text-teal-500">{framework.guidance.map((l) => <li key={l}>{l}</li>)}</ul></SheetRow> : null}
              <SheetRow label="Reviewer sign-off">
                {approvals.length ? (
                  <ul className="space-y-1.5">{approvals.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-x-2"><CheckCircle size={16} weight="fill" className="text-emerald-600" aria-hidden="true" /><strong className="font-medium">{person.get(a.deciderId) ?? "Approver"}</strong><span className="text-slate-500">signed off {fmtDate(a.createdAt)}</span>{a.comment ? <span className="text-slate-600">“{a.comment}”</span> : null}</li>)}</ul>
                ) : (
                  <span className="flex flex-wrap items-center gap-2 text-amber-800"><Warning size={16} weight="fill" aria-hidden="true" />{v?.origin === "SEED" ? "Awaiting sign-off. This is CSB starter text and has no approval record yet." : "No sign-off recorded for this version."}</span>
                )}
                <p className="mt-2 text-[13px] text-slate-600">Owner: {(p.ownerId && person.get(p.ownerId)) || "Registered manager"} · Reviewer: {(p.reviewerId && person.get(p.reviewerId)) || "Not assigned"} · Approver: {(p.approverId && person.get(p.approverId)) || "Not assigned"}</p>
              </SheetRow>
            </dl>
          </section>
        </TabPanel>

        {v ? (
          <TabPanel value="text">
            <Panel title={isPolicy ? "Policy Text" : `${typeName} Text`} note={details ? <><span className="mr-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-px text-[12px] font-medium text-navy-900">Highlighted</span> details fill in from <Link href="/settings#business">Settings</Link>.</> : null}>
              <div className="space-y-7">
                {textSections.map((s, i) => (
                  <section key={s.key} id={`text-${s.key}`}>
                    <h3 className="flex items-baseline gap-3 text-[17px] font-medium tracking-normal text-navy-900"><span className="font-mono text-sm font-normal text-teal-600">{i + 1}</span>{s.heading}{s.isLocal ? <Badge tone="teal">local</Badge> : null}</h3>
                    <TagBody body={s.body} details={details} className="mt-2 text-[15.5px] leading-7 text-slate-800" />
                  </section>
                ))}
              </div>
            </Panel>
          </TabPanel>
        ) : null}

        {procedure.length || definitions ? (
          <TabPanel value="procedure">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Panel title="Procedure" note="How staff put this policy into practice, step by step.">
                <div className="space-y-7">
                  {procedure.map((s, i) => (
                    <section key={s.key} id={s.key} className="scroll-mt-24">
                      <h3 className="flex items-baseline gap-3 text-[17px] font-medium tracking-normal text-navy-900"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-900 font-mono text-[12px] font-normal text-white">{i + 1}</span>{s.heading}</h3>
                      <TagBody body={s.body} details={details} className="mt-2 pl-9 text-[15.5px] leading-7 text-slate-800" />
                    </section>
                  ))}
                </div>
              </Panel>
              <div className="space-y-4">
                {procedure.length ? (
                  <Panel title="Key facts for staff" tone="teal">
                    <ul className="space-y-2.5 text-[14px] leading-6 text-slate-800">
                      {procedure.map((s) => <li key={s.key} className="flex gap-2"><Lightbulb size={16} weight="fill" className="mt-1 shrink-0 text-teal-600" aria-hidden="true" /><span><TagText text={firstSentence(s.body)} details={details} /></span></li>)}
                    </ul>
                  </Panel>
                ) : null}
                {definitions ? (
                  <Panel title="Definitions">
                    <TagBody body={definitions.body} details={details} className="text-[14px] leading-6 text-slate-800" />
                  </Panel>
                ) : null}
                {reading.length ? (
                  <Panel title="Further reading">
                    <ul className="space-y-2 text-[14px] leading-5">
                      {reading.map((r) => <li key={r.id}><a href={r.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1.5"><ArrowSquareOut size={14} className="mt-[3px] shrink-0" aria-hidden="true" />{r.title}</a><span className="block pl-5 text-[12px] text-slate-500">{r.exactReference}</span></li>)}
                    </ul>
                  </Panel>
                ) : null}
              </div>
            </div>
          </TabPanel>
        ) : null}

        <TabPanel value="forms">
          <Panel title={isPolicy ? "Associated forms" : "Related policies"} note={isPolicy ? "Download a form in Word to fill in and sign, or as a PDF to print. Use Email to send a link with your notification or referral." : undefined}>
            {isPolicy ? (
              forms.length ? (
                <table className="w-full min-w-[640px] border-collapse text-[14px]">
                  <thead><tr className="h-[38px] text-left text-[13px] text-slate-700"><th className="w-[46px] font-normal"><span className="sr-only">Type</span></th><th className="font-normal">Name</th><th className="w-[130px] font-normal">Type</th><th className="w-[290px] text-right font-normal">Actions</th></tr></thead>
                  <tbody>
                    {forms.map((f) => (
                      <tr key={f.id} className="h-[52px] border-t border-slate-200 odd:bg-[#f5f9fc]" data-testid={`form-${f.ref}`}>
                        <td className="pl-3"><FileDoc size={26} className="text-[#2b579a]" aria-hidden="true" /></td>
                        <td><Link href={`/policies/${f.id}`} className="font-medium text-[#1d4f91] no-underline hover:underline">{f.title}.docx</Link><span className="block text-[12px] text-slate-500">{f.ref.replace(/^CSB-/, "")} · {f.currentPublishedVersion?.label ?? "draft"}</span></td>
                        <td className="text-slate-700">{new Map<string, string>(DOC_TYPES).get(f.docType) ?? f.docType}</td>
                        <td className="pr-3">
                          <span className="flex justify-end gap-1.5">
                            <a className="btn-secondary px-2.5 py-1 text-xs" href={`/api/policies/${f.id}/download?format=docx`} download><FileDoc size={14} aria-hidden="true" />Word</a>
                            <a className="btn-secondary px-2.5 py-1 text-xs" href={`/api/policies/${f.id}/download?format=pdf`} download><FilePdf size={14} aria-hidden="true" />PDF</a>
                            <a className="btn-secondary px-2.5 py-1 text-xs" href={`mailto:?subject=${encodeURIComponent(`${f.title} (${f.ref})`)}&body=${encodeURIComponent(`Please find the ${f.title} attached, completed in line with our ${p.title} policy.\n\n`)}`}><EnvelopeSimple size={14} aria-hidden="true" />Email</a>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty>No forms are linked to this policy yet.</Empty>
            ) : null}
            {related.length ? (
              <div className={isPolicy ? "mt-6" : ""}>
                {isPolicy ? <h3 className="mb-2 text-[15px] font-medium tracking-normal text-navy-900">Related policies</h3> : null}
                <ul className="grid gap-x-6 sm:grid-cols-2">
                  {related.map((r) => <li key={r.id} className="flex gap-3 border-b border-slate-200 py-2 text-[14px]"><span className="w-[64px] shrink-0 text-slate-500">{r.ref.replace(/^CSB-/, "")}</span><Link href={`/policies/${r.id}`} className="font-medium text-[#1d4f91] no-underline hover:underline">{r.title}</Link></li>)}
                </ul>
              </div>
            ) : !isPolicy ? <Empty>No related policies recorded.</Empty> : null}
          </Panel>
        </TabPanel>

        {v ? (
          <TabPanel value="document">
            <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
              <nav aria-label="Contents" className="hidden lg:block">
                <div className="sticky top-20">
                  <p className="eyebrow mb-3">Contents</p>
                  <ol className="space-y-px border-l border-slate-300 text-[13px]">
                    {sections.map((s, i) => (
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
                    {sections.map((s, i) => (
                      <section key={s.key} id={s.key} className="scroll-mt-24">
                        <h2 className="flex items-baseline gap-3 text-[1.3rem]">
                          <span className="font-mono text-sm font-normal text-teal-600">{i + 1}</span>
                          {s.heading}
                          {s.isLocal ? <Badge tone="teal">local</Badge> : null}
                        </h2>
                        <TagBody body={s.body} details={details} className="mt-2.5 text-[16px] leading-[1.75] text-slate-800" />
                      </section>
                    ))}
                  </div>
                </div>
              </article>
            </div>
          </TabPanel>
        ) : null}
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
      {!v ? <div className="mt-4"><Empty>This policy has not been published yet. See its open revisions under Versions.</Empty></div> : null}
    </>
  );
}

const IMPACT_TEXT = [
  "Routine review. No change to day-to-day practice is expected.",
  "Worth briefing staff at the next team meeting and checking practice matches the updated text.",
  "Brief staff promptly and check practice changes are in place within the agreed timescale.",
];

/** Splits the generated "Legislation, guidance and CQC quality statements" section into its three lists. */
function parseFramework(body?: string) {
  const out = { legal: [] as string[], guidance: [] as string[], qs: [] as string[] };
  let into: string[] | null = null;
  for (const line of (body ?? "").split("\n")) {
    if (/legal and regulatory requirements/.test(line)) into = out.legal;
    else if (/guidance:$/.test(line)) into = out.guidance;
    else if (/quality statements:$/.test(line)) into = out.qs;
    else if (line.startsWith("• ") && into) into.push(line.slice(2));
  }
  return out;
}

function firstSentence(body: string) {
  const text = body.split("\n").map((l) => l.replace(/^(\d+[.)]|[•\-*])\s+/, "")).find(Boolean) ?? "";
  const m = text.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim();
}

function SheetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid border-t border-slate-200 sm:grid-cols-[260px_minmax(0,1fr)]">
      <dt className="px-5 py-3.5 font-medium text-slate-800 sm:border-r sm:border-slate-200">{label}</dt>
      <dd className="px-5 py-3.5 leading-6 text-slate-800">{children}</dd>
    </div>
  );
}

function Panel({ title, note, tone, children }: { title: string; note?: React.ReactNode; tone?: "teal"; children: React.ReactNode }) {
  return (
    <section className={`rounded-[3px] px-5 pb-5 pt-4 ${tone === "teal" ? "border-[1.5px] border-teal-400 bg-teal-100" : "bg-white shadow-[0_0_0_1px_#eef1f3]"}`}>
      <div className="mb-4 border-b border-slate-200 pb-2.5">
        <h2 className="text-[18px] font-medium tracking-normal text-navy-900">{title}</h2>
        {note ? <p className="mt-0.5 text-[13px] text-slate-600">{note}</p> : null}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function ImpactBars({ level }: { level: number }) {
  const fill = level === 1 ? "#28b463" : "#2f8bf4";
  return (
    <svg role="img" aria-label={`${["Low", "Medium", "High"][level - 1]} impact`} width="36" height="26" viewBox="0 0 30 22">
      {[0, 1, 2].map((i) => <rect key={i} x={2 + i * 8} y={15 - i * 6.5} width="5" height={7 + i * 6.5} fill={i < level ? fill : "#dfe5e8"} />)}
    </svg>
  );
}

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
