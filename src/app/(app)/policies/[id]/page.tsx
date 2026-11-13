import Link from "@/components/link";
import { ModuleHeader } from "@/components/module-header-band";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { markOpened } from "@/server/policies/assignment";
import { canOnPolicy, hasOrgPermission } from "@/server/auth/rbac";
import { canOpenDraft, getPolicy } from "@/server/policies/library";
import { bookmarksFor } from "@/server/policies/bookmarks";
import { REVIEW_MARKER } from "@/server/policy-geo/generator";
import { newRevisionAction, rollbackAction, confirmImplementationAction, logReadAndSignAction, startFormAction } from "../../../actions";
import { DOC_TYPES } from "../../../../../prisma/seed-data/library/types";
import { Badge, Empty, Flash, fmtDate, SimulatedBadge, StatusBadge } from "@/components/ui";
import { TagBody, TagText } from "@/components/tag-text";
import { businessDetails } from "@/server/business";
import { missingDetails, personaliseSections } from "@/lib/business";
import { firstSentence, missingParts, readerParts, sectionForView, type ReaderPart, type ReaderPartId } from "@/lib/policy-reader";
import { Timeline, TimelineItem } from "@/components/timeline";
import { ActionDialog } from "@/components/dialog";
import { PrintButton } from "@/components/print-button";
import { BookmarkToggle, PolicyReader, ReaderNav, ReaderProgress, type ReaderNavItem } from "@/components/policy-reader";
import { startableByRef } from "@/server/forms/records";
import { linkedResourcesFor, type LinkedResource, type ResourceUse } from "@/server/forms/links";
import {
  ArrowSquareOut, ArrowsClockwise, Books, BookOpenText, CalendarBlank, CalendarCheck, CaretDown, CheckCircle, ClipboardText, ClockCounterClockwise, DownloadSimple, FileDoc, FilePdf, FileText,
  Flag, GitDiff, Info, Lightbulb, ListChecks, ListNumbers, MapPin, Notepad, Paperclip, PencilSimpleLine, Printer, Scales, ShieldCheck, Signature, Sparkle, Target, Translate, UserList, UsersThree, Warning,
} from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

/**
 * The Policy Reader (owner's spec of 5 Nov 2026). One continuous document: the Review Sheet first, then the policy's
 * own sections in reading order, then its forms and resources. A sticky strip of section cards follows the reader as
 * they scroll; on the right, reading progress, the person's own policy actions and the linked forms.
 *
 * Versions, Regulation Map, Read & Sign and Regulatory Flags are record views of the same policy (`?view=`), reached
 * from the header. Nothing here edits a published version: Edit starts a revision, which an authorised person publishes
 * directly as a new version (owner's brief of 5 Nov 2026: no mandatory approval step).
 */
export default async function PolicyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const canEditDetails = hasOrgPermission(ctx, "org.manage");
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
  const overdue = Boolean(p.nextReviewDate && p.nextReviewDate < now);
  const dueSoon = Boolean(!overdue && p.nextReviewDate && p.nextReviewDate.getTime() - now.getTime() < 60 * 86400000);
  const flags = p.candidates.length;
  const byStatus = LEGAL_ORDER.map(([status, label]) => ({ label, items: links.filter((l) => l.requirement.legalStatus === status) })).filter((g) => g.items.length);

  const published = v ? p.versions.find((x) => x.id === v.id) : undefined;
  const approvals = published?.approvals.filter((a) => a.decision === "APPROVE") ?? [];
  const relatedRefs = [...(v?.sections.find((s) => s.key === "related")?.body.matchAll(/CSB-[A-Z]+-\d+/g) ?? [])].map((m) => m[0]);
  const [details, people, impact, forms, related, scopes, marks] = await Promise.all([
    p.organisationId ? businessDetails(p.organisationId) : null,
    db.user.findMany({ where: { id: { in: [...approvals.map((a) => a.deciderId), p.ownerId, p.reviewerId, ...(p.kind === "CUSTOMER" ? p.publications.map((x) => x.publishedById) : [])].filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
    db.impactAssessment.findFirst({ where: { policyId: { in: [p.id, ...(p.templateId ? [p.templateId] : [])] } }, orderBy: { createdAt: "desc" }, select: { urgency: true, createdAt: true } }),
    // Forms, templates, checklists and tools linked to this policy (explicit links first, then any named only in a
    // resource's "Related policies" text). Only published, active resources are offered, so a draft is never handed
    // out as though it were approved.
    isPolicy ? linkedResourcesFor(p, v?.sections ?? []) : Promise.resolve([] as LinkedResource[]),
    relatedRefs.length ? db.policy.findMany({ where: { organisationId: p.organisationId, ref: { in: relatedRefs } }, select: { id: true, ref: true, title: true, docType: true } }) : [],
    p.organisationId ? db.policyBranchScope.findMany({ where: { policyId: p.id, organisationId: p.organisationId }, select: { branch: { select: { name: true } } } }) : [],
    bookmarksFor(ctx, p.id),
  ]);
  const person = new Map(people.map((u) => [u.id, u.name]));
  // Who made each version live. CSB's own staff are never named to an organisation; automatic central updates say so.
  const versionPublisher = (ver: { id: string; origin: string; createdById: string | null }) => {
    if (p.kind === "MASTER" || ver.origin === "SEED") return "CSB";
    if (ver.origin === "MASTER_SYNC" && !ver.createdById) return "CSB central update";
    const by = p.publications.find((x) => x.versionId === ver.id)?.publishedById;
    return (by && person.get(by)) || "a former member";
  };
  const publishedBy = v ? versionPublisher(p.versions.find((x) => x.id === v.id) ?? { id: v.id, origin: v.origin, createdById: v.createdById }) : null;
  // Organisation policies carry the organisation's details; CSB templates stay generic.
  const sections = v ? (p.organisationId ? personaliseSections(v.sections, p.docType) : v.sections) : [];
  const parts = readerParts(sections, isPolicy ? "policy" : "resource");
  const procedure = sections.filter((s) => s.key.startsWith("procedure."));
  const framework = parseFramework(sections.find((s) => s.key === "framework")?.body);
  const reading = [...new Map(links.filter((l) => l.requirement.sourceUrl && !l.requirement.isSimulated).map((l) => [l.requirement.sourceUrl, l.requirement])).values()];
  const missing = details ? missingDetails(details) : [];

  const latestPub = p.publications.find((x) => x.status === "PUBLISHED");
  const myAck = latestPub?.acknowledgements.find((a) => a.userId === ctx.userId);
  const lastChanged = p.versions.find((x) => x.status === "PUBLISHED" || x.status === "SUPERSEDED");
  const previous = v ? p.versions.find((x) => x.status === "SUPERSEDED" && x.versionNumber < v.versionNumber) : undefined;
  const openRevision = canOpenDraft(ctx, p.kind) ? p.revisions.find((r) => !r.closedAt) : undefined;
  const starter = v?.origin === "SEED";
  const level = impact ? (impact.urgency === "URGENT" || impact.urgency === "HIGH" ? 3 : impact.urgency === "MEDIUM" ? 2 : 1) : 0;
  // A CSB central document shown in the organisation's library can be assigned too: the sign-off page explains that
  // staff sign the organisation's own copy and offers to create it.
  const canAssign = Boolean(ctx.organisationId && (p.organisationId === ctx.organisationId || (p.kind === "MASTER" && !p.organisationId)) && hasOrgPermission(ctx, "signoff.manage"));
  const canCompare = p.versions.length > 1;

  // Record views of the same policy. The reader is the default; older links (?view=procedure) open it at that section.
  const RECORD_VIEWS = ["history", "requirements", "publications", "flags"] as const;
  type RecordView = (typeof RECORD_VIEWS)[number];
  const view: RecordView | "reader" = (RECORD_VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as RecordView) : "reader";
  const viewLinks: { key: RecordView | "reader"; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "reader", label: isPolicy ? "Policy" : typeName, icon: <BookOpenText size={16} /> },
    { key: "history", label: "Versions", icon: <ClockCounterClockwise size={16} />, count: p.versions.length },
    { key: "requirements", label: "Regulation Map", icon: <Scales size={16} />, count: links.length },
    { key: "publications", label: "Read & Sign", icon: <Signature size={16} /> },
    { key: "flags", label: "Reg. Flags", icon: <Flag size={16} />, count: flags || undefined },
  ];

  // The section strip: Review Sheet, the document's parts, then Forms & Resources.
  const showForms = isPolicy || related.length > 0;
  const navItems: ReaderNavItem[] = [
    { id: "review", label: "Review Sheet", number: 1, icon: <Notepad /> },
    ...parts.map((part, i) => ({ id: part.id, label: part.label, number: i + 2, icon: PART_ICON[part.id] })),
    ...(showForms ? [{ id: "forms", label: isPolicy ? "Forms & Resources" : "Related", number: parts.length + 2, icon: <Paperclip /> }] : []),
  ];
  const numberOf = new Map(navItems.map((n) => [n.id, n.number]));
  const notWritten = isPolicy && v ? missingParts(parts) : [];
  const placeholders = sections.filter((s) => s.body.includes("[Complete locally]")).map((s) => s.heading);
  const reviewMarkers = sections.filter((s) => s.body.includes(REVIEW_MARKER)).map((s) => s.heading);
  const unverified = links.filter((l) => l.requirement.verificationStatus !== "VERIFIED").length;
  const outstanding = [
    overdue ? `Review is overdue (was due ${fmtDate(p.nextReviewDate)}).` : null,
    openRevision ? "A revision is in progress and has not been published yet." : null,
    starter ? "This version is CSB starter text and has not been professionally reviewed. Check it fits your service." : null,
    !p.reviewerId && p.kind === "CUSTOMER" ? "No reviewer is assigned for the next scheduled review." : null,
    details && missing.length && isPolicy ? "Your business details are incomplete, so parts of the text are not personalised." : null,
    placeholders.length ? `Sections still to complete locally: ${placeholders.join(", ")}.` : null,
    reviewMarkers.length ? `Review markers left in: ${reviewMarkers.join(", ")}.` : null,
    unverified ? `${unverified} linked regulatory reference${unverified === 1 ? " has" : "s have"} not been checked against the official source.` : null,
    notWritten.length ? `Not written yet: ${notWritten.join(", ")}.` : null,
  ].filter((x): x is string => Boolean(x));
  const reviewStatus = !v ? { label: "Not published", tone: "amber" as const } : overdue ? { label: "Overdue", tone: "rose" as const } : openRevision ? { label: "Revision in progress", tone: "blue" as const } : dueSoon ? { label: "Due soon", tone: "amber" as const } : { label: "Up to date", tone: "green" as const };
  const workflows = digitalWorkflows(p.categoryCode, ctx);
  // Forms placed at a procedure step are also shown inside that step.
  // Forms that can be filled in on screen (by reference); only ones this person is asked to complete.
  const onScreen = forms.length ? await startableByRef(ctx) : new Map<string, string>();
  const stepForms = new Map<string, StepForm[]>();
  for (const f of forms) for (const use of f.uses) if (use.placement) stepForms.set(use.placement.sectionKey, [...(stepForms.get(use.placement.sectionKey) ?? []), { ...f, use, startId: onScreen.get(f.ref) ?? null }]);
  const canManageLinks = Boolean(isPolicy && p.kind === "CUSTOMER" && p.organisationId === ctx.organisationId && p.status === "ACTIVE" && hasOrgPermission(ctx, "policy.author"));

  return (
    <div className="policy-reader-page">

      {details && missing.length && isPolicy ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-[#f4c7cb] bg-[#fff6f6] px-4 py-2.5 text-[14px] text-[#a3242c]">
          <span className="min-w-0 flex-1">Your business details are incomplete, so parts of this policy are not yet personalised to your organisation.</span>
          <Link href="/settings#business" className="btn-secondary">Complete details</Link>
        </div>
      ) : null}

      <ModuleHeader
        title={<>{p.ref} · {p.title}</>}
        page={p.title}
        crumbs={[
          { label: p.kind === "MASTER" ? "CSB Template Library" : "Policy Library", href: p.kind === "MASTER" ? "/policies?tab=templates" : "/policies" },
          { label: p.category.name, href: `/policies?category=${p.categoryCode}${p.kind === "MASTER" ? "&tab=templates" : ""}` },
        ]}
        description={<>{p.category.name} · {typeName} · {p.kind === "MASTER" ? "CSB template" : "Our policy"}{p.scopeMode === "BRANCH_SPECIFIC" ? " · Branch-specific" : p.scopeMode === "SHARED_WITH_APPENDICES" ? " · With branch appendices" : ""}</>}
        actions={
          <div className="reader-noprint flex flex-wrap items-center gap-2">
            {v ? (
              <details className="reader-menu">
                <summary className="btn-secondary cursor-pointer" data-testid="download-menu"><DownloadSimple size={16} aria-hidden="true" />Download<CaretDown size={13} aria-hidden="true" /></summary>
                <div className="reader-menu-list">
                  <a href={`/api/policies/${p.id}/download?format=docx`} download data-testid="download-docx"><FileDoc size={18} className="text-[#2b579a]" aria-hidden="true" />Word document (.docx)</a>
                  <a href={`/api/policies/${p.id}/download?format=pdf`} download data-testid="download-pdf"><FilePdf size={18} className="text-[#b42318]" aria-hidden="true" />PDF</a>
                </div>
              </details>
            ) : null}
            {v ? <PrintButton className="btn-secondary"><Printer size={16} aria-hidden="true" />Print</PrintButton> : null}
            {latestPub && ctx.organisationId ? (
              myAck?.acknowledgedAt ? (
                <span className="reader-pill h-[38px] border border-[#abefc6] bg-[#ecfdf3] px-3 text-[#067647]" data-testid="signed-state"><CheckCircle size={16} weight="fill" aria-hidden="true" />Read &amp; signed {fmtDate(myAck.acknowledgedAt)}</span>
              ) : (
                <form action={logReadAndSignAction}>
                  <input type="hidden" name="policyId" value={p.id} />
                  <input type="hidden" name="back" value={back} />
                  <button className="btn-secondary" type="submit" data-testid="log-read-sign"><Signature size={16} aria-hidden="true" />Log Read &amp; Sign</button>
                </form>
              )
            ) : null}
            {canAuthor ? (
              openRevision ? (
                <Link className="btn-primary" href={`/revisions/${openRevision.id}`}><PencilSimpleLine size={16} aria-hidden="true" />Continue revision</Link>
              ) : (
                <ActionDialog trigger={<><PencilSimpleLine size={16} aria-hidden="true" />{v ? "Edit · Start revision" : "Start revision"}</>} title={`Revise ${p.ref}`} description="Published text is never edited directly. A revision creates a draft copy of the current text; nothing changes for staff until the draft is published.">
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
              )
            ) : null}
          </div>
        }
      />
      <header className="reader-head" data-testid="reader-header">
        <div className="flex flex-wrap items-center gap-2">
          <VersionState version={v} starter={starter} />
          {v ? <span className="reader-pill bg-[#f2f4f7] text-[#344054]" data-testid="reader-version">Version {v.label}</span> : null}
          <span className={`reader-pill ${overdue ? "bg-[#fef3f2] text-[#b42318]" : "bg-[#f2f4f7] text-[#344054]"}`}><CalendarBlank size={14} aria-hidden="true" />{overdue ? `Review overdue since ${fmtDate(p.nextReviewDate)}` : `Next review ${fmtDate(p.nextReviewDate)}`}</span>
          {openRevision ? <Link href={`/revisions/${openRevision.id}`} className="reader-pill bg-[#eff8ff] !text-[#175cd3] no-underline hover:underline"><PencilSimpleLine size={14} aria-hidden="true" />Revision in progress</Link> : null}
          <SimulatedBadge show={Boolean(v?.isSimulated)} />
        </div>
        <nav aria-label="Policy record views" className="reader-noprint mt-4 border-t border-[#f2f4f7] pt-3">
          <ul className="reader-views" data-testid="record-views">
            {viewLinks.map((l) => (
              <li key={l.key}>
                <Link
                  href={l.key === "reader" ? back : `${back}?view=${l.key}`}
                  aria-current={view === l.key ? "page" : undefined}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[13.5px] font-medium no-underline ${view === l.key ? "bg-[#f1ecfc] !text-module-strong" : "!text-[#475467] hover:bg-[#f9fafb] hover:!text-[#101828]"}`}
                >
                  <span aria-hidden="true" className="flex">{l.icon}</span>{l.label}
                  {l.count !== undefined ? <span className={`rounded-full px-1.5 text-[11.5px] font-semibold leading-[18px] ${l.key === "flags" ? "bg-[#fde1e3] text-[#a3242c]" : "bg-[#f2f4f7] text-[#475467]"}`}>{l.count}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <Flash searchParams={sp} />

      {view === "reader" ? (
        <PolicyReader items={navItems} initial={sectionForView(sp.view)} key={v?.id ?? p.id}>
          <ReaderNav />
          <div className="reader-grid">
            <article className="reader-doc min-w-0" data-reader-document aria-label={`${p.ref} ${p.title}`}>
              {/* 1. Review Sheet */}
              <section id="review" className="reader-section !p-0" aria-labelledby="h-review" data-testid="review-sheet">
                <div className="reader-sheet-head">
                  <h2 id="h-review" tabIndex={-1} data-reader-heading className="reader-h2"><span className="num">1</span>Review Sheet</h2>
                </div>
                <div className="px-4 pb-6 pt-4 sm:px-8">
                  <div className="reader-facts" data-testid="review-facts">
                    <Fact icon={<CalendarCheck size={20} />} label="Last reviewed" value={!v ? "Not published" : fmtDate(v.publishedAt ?? v.effectiveDate)} />
                    <Fact icon={<CalendarBlank size={20} />} label="Last amended" value={lastChanged ? fmtDate(lastChanged.publishedAt ?? lastChanged.createdAt) : "Never"} />
                    <Fact icon={<CalendarBlank size={20} />} label="Next review" value={fmtDate(p.nextReviewDate) || "Not set"} tone={overdue ? "rose" : undefined} />
                    <Fact icon={<ArrowsClockwise size={20} />} label="Review interval" value={p.reviewIntervalMonths === 12 ? "Annually" : `Every ${p.reviewIntervalMonths} months`} />
                    <Fact icon={<ShieldCheck size={20} />} label="Review status" value={reviewStatus.label} tone={reviewStatus.tone} />
                  </div>
                  <div className="mt-5 overflow-hidden rounded-[10px] border border-[#eaecf0]">
                    <table className="reader-table">
                      <caption className="sr-only">Review sheet details</caption>
                      <tbody>
                        <Row label="Policy reference"><span className="font-semibold">{p.ref}</span></Row>
                        <Row label="Policy title">{p.title}</Row>
                        <Row label="Version">{v ? <span className="flex flex-wrap items-center gap-2">Version {v.label} <StatusBadge status={v.status} />{previous ? <span className="text-[13px] text-[#667085]">Previous: version {previous.label}, published {fmtDate(previous.publishedAt)}</span> : <span className="text-[13px] text-[#667085]">First issue</span>}</span> : "No published version"}</Row>
                        <Row label="Category / Subcategory">{p.category.name} / {typeName}</Row>
                        <Row label="Applicable to">
                          <ul className="space-y-0.5">
                            <li>{scopeLine(p.scopeMode, scopes.map((s) => s.branch.name))}</li>
                            <li>Services: {p.serviceTypes.length ? p.serviceTypes.map((t) => SERVICE_NAMES[t] ?? t.toLowerCase()).join(", ") : "All service types"}</li>
                            {numberOf.get("scope") ? <li>Staff: everyone named in <a href="#scope">Scope (section {numberOf.get("scope")})</a></li> : null}
                          </ul>
                        </Row>
                        <Row label="Policy owner">{(p.ownerId && person.get(p.ownerId)) || <NotAssigned />}</Row>
                        <Row label="Reviewer">{(p.reviewerId && person.get(p.reviewerId)) || <NotAssigned />}</Row>
                        <Row label="Published by">
                          {!v ? "Not published" : (
                            <span className="flex flex-wrap items-center gap-x-2"><CheckCircle size={16} weight="fill" className="text-[#079455]" aria-hidden="true" /><strong className="font-medium">{publishedBy}</strong><span className="text-[#667085]">{fmtDate(v.publishedAt)}</span></span>
                          )}
                          {approvals.length ? <span className="mt-1 block text-[#667085]">Also reviewed by {approvals.map((a) => person.get(a.deciderId) ?? "a former member").join(", ")} under the earlier review process.</span> : null}
                        </Row>
                        <Row label="Effective date">{v ? fmtDate(v.effectiveDate) || "Not recorded" : "Not published"}</Row>
                        <Row label="Business impact">
                          {level ? (
                            <span className="flex items-center gap-4">
                              <span className="flex flex-col items-center"><ImpactBars level={level} /><span className={`mt-0.5 text-[11px] font-bold uppercase ${level === 3 ? "text-[#b42318]" : level === 2 ? "text-[#b54708]" : "text-[#067647]"}`}>{["Low", "Medium", "High"][level - 1]}</span></span>
                              <span>{IMPACT_TEXT[level - 1]} <span className="text-[13px] text-[#667085]">From the impact assessment of {fmtDate(impact!.createdAt)}.</span></span>
                            </span>
                          ) : <span className="text-[#475467]">Not assessed. No regulatory change has needed an impact assessment of this policy.</span>}
                        </Row>
                        <Row label="Reason for review">{!v ? "Not published" : v.origin === "SEED" ? "Adopted from the CSB starter library; due for your first local review" : published?.reasonForChange ?? "Not recorded"}</Row>
                        <Row label="Summary of changes">{v && v.versionNumber > 1 ? published?.changeSummary ?? "Not recorded" : "No changes: first issue."}</Row>
                        <Row label="Relevant legislation & guidance">
                          {framework.legal.length || framework.guidance.length ? (
                            <ul className="ml-5 list-disc space-y-1 marker:text-[#7a5ac9]">{[...framework.legal, ...framework.guidance].map((l) => <li key={l}>{l}</li>)}</ul>
                          ) : <span className="text-[#475467]">None recorded in this version.</span>}
                          {links.length ? <p className="mt-2 text-[13px] text-[#667085]">{links.length - unverified} of {links.length} mapped references checked against the official source. <Link href={`${back}?view=requirements`}>Regulation Map</Link></p> : null}
                        </Row>
                        {framework.qs.length ? (
                          <Row label="CQC quality statements">
                            <ul className="flex flex-wrap gap-2">{framework.qs.map((q) => { const [kq, title] = q.split(/:\s*/, 2); return <li key={q} className="rounded-full border border-[#e4dafb] bg-module/[.04] px-2.5 py-0.5 text-[13px] text-[#101828]"><strong className="font-semibold">{kq}</strong> · {title}</li>; })}</ul>
                          </Row>
                        ) : null}
                        {reading.length ? (
                          <Row label="Regulatory source links">
                            <ul className="space-y-1.5">{reading.slice(0, 6).map((r) => <li key={r.id}><a href={r.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1.5"><ArrowSquareOut size={14} className="mt-[3px] shrink-0" aria-hidden="true" />{r.title}<span className="sr-only"> (opens in a new tab)</span></a> <Verification status={r.verificationStatus} /></li>)}</ul>
                          </Row>
                        ) : null}
                        <Row label="Outstanding review requirements">
                          {outstanding.length ? (
                            <ul className="space-y-1" data-testid="outstanding-requirements">{outstanding.map((o) => <li key={o} className="flex gap-2"><Warning size={15} className="mt-[3px] shrink-0 text-[#b54708]" aria-hidden="true" />{o}</li>)}</ul>
                          ) : <span className="flex items-center gap-2 text-[#067647]"><CheckCircle size={16} weight="fill" aria-hidden="true" />Nothing outstanding.</span>}
                        </Row>
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              {v?.origin === "SEED" ? (
                <div className="mx-4 mb-2 flex gap-3 rounded-[10px] border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-[13.5px] leading-5 text-[#93370d] sm:mx-8">
                  <Warning size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>This is CSB starter text. It has not been professionally reviewed. Check it fits your service and add your local details before staff rely on it.</span>
                </div>
              ) : null}

              {!v ? <div className="reader-section"><Empty>This policy has not been published yet. See its open revisions under Versions.</Empty></div> : null}

              {parts.map((part) => (
                <PartSection key={part.id} part={part} number={numberOf.get(part.id)!}>
                  <PartBody part={part} procedure={procedure} details={details} canEdit={canEditDetails} framework={framework} reading={reading} related={related} stepForms={stepForms} />
                </PartSection>
              ))}

              {showForms ? (
                <section id="forms" className="reader-section" aria-labelledby="h-forms" data-testid="forms-section">
                  <h2 id="h-forms" tabIndex={-1} data-reader-heading className="reader-h2"><span className="num">{numberOf.get("forms")}</span>{isPolicy ? "Forms & Resources" : "Related policies"}</h2>
                  {isPolicy ? (
                    <>
                      <p className="mt-1 text-[14px] text-[#475467]">Download a form in Word to fill in and sign, or as a PDF to print. Only published resources are listed.</p>
                      {forms.length ? (
                        <div className="mt-4 overflow-x-auto rounded-[10px] border border-[#eaecf0]">
                          <table className="w-full min-w-[620px] border-collapse text-[14px]">
                            <thead><tr className="h-[40px] bg-[#f9fafb] text-left text-[12.5px] font-semibold text-[#475467]"><th className="w-[44px] pl-3"><span className="sr-only">File</span></th><th>Name</th><th className="w-[140px]">Type</th><th className="w-[260px] pr-3 text-right">Actions</th></tr></thead>
                            <tbody>
                              {forms.map((f) => (
                                <tr key={f.id} className="h-[54px] border-t border-[#f2f4f7]" data-testid={`form-${f.ref}`}>
                                  <td className="pl-3"><FileDoc size={24} className="text-[#2b579a]" aria-hidden="true" /></td>
                                  <td className="py-2"><Link href={`/policies/${f.id}`} className="font-medium no-underline hover:underline">{f.title}</Link>{f.required ? <span className="ml-2 rounded-full bg-[#fef3f2] px-1.5 text-[11.5px] font-semibold leading-[18px] text-[#b42318]">Required</span> : null}<span className="block text-[12px] text-[#667085]">{f.ref} · version {f.versionLabel}{f.starter ? " · CSB starter text" : ""}</span><LinkMeta f={f} /></td>
                                  <td className="text-[#344054]">{f.typeLabel}</td>
                                  <td className="pr-3">
                                    <span className="flex justify-end gap-1.5">
                                      {onScreen.get(f.ref) ? <StartForm definitionId={onScreen.get(f.ref)!} back={`/policies/${p.id}#forms`} /> : null}
                                      <a className="btn-secondary !min-h-0 px-2.5 py-1 text-xs" href={`/api/policies/${f.id}/download?format=docx`} download><FileDoc size={14} aria-hidden="true" />Word</a>
                                      <a className="btn-secondary !min-h-0 px-2.5 py-1 text-xs" href={`/api/policies/${f.id}/download?format=pdf`} download><FilePdf size={14} aria-hidden="true" />PDF</a>
                                      <Link className="btn-secondary !min-h-0 px-2.5 py-1 text-xs" href={`/policies/${f.id}`}>Open</Link>
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <div className="mt-4"><Empty>No forms are linked to this policy yet.</Empty></div>}
                      {canManageLinks || forms.length ? (
                        <p className="mt-3 text-[13px] text-[#667085]">
                          {forms.some((f) => f.source === "TEXT") ? "Forms marked \u201cnamed in the form\u2019s Related policies\u201d have no confirmed link yet. " : null}
                          {canManageLinks ? <Link href={`/policies/${p.id}/resources`} data-testid="manage-form-links">Manage linked forms</Link> : <Link href={`/policies/${p.id}/resources`}>Link history</Link>}
                        </p>
                      ) : null}
                      {workflows.length ? (
                        <div className="mt-5">
                          <h3 className="reader-h3">Record it in CSB Care</h3>
                          <ul className="mt-2 flex flex-wrap gap-2">{workflows.map((w) => <li key={w.href}><Link className="btn-secondary" href={w.href}>{w.label}</Link></li>)}</ul>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {related.length && isPolicy ? <p className="mt-5 text-[14px] text-[#475467]">Related policies are listed under <a href="#further-reading">Further Reading</a>.</p> : null}
                  {!isPolicy ? <RelatedList related={related} /> : null}
                </section>
              ) : null}
            </article>

            <aside className="reader-aside reader-noprint" aria-label="Policy management">
              <ReaderProgress />
              <section className="hb-pn hb-c-navy" aria-labelledby="reader-actions-title" data-testid="policy-actions">
                <div className="hb-pn-h"><h2 id="reader-actions-title">Policy Actions</h2></div>
                <ul className="space-y-0.5 p-1.5">
                  {ctx.organisationId ? (
                    <>
                      <li><BookmarkToggle policyId={p.id} kind="IMPORTANT" initial={marks.IMPORTANT} /></li>
                      <li><BookmarkToggle policyId={p.id} kind="READING_LIST" initial={marks.READING_LIST} /></li>
                    </>
                  ) : null}
                  {canAssign ? (
                    <li><Link className="reader-action" href={`/staff/policy/${p.id}`} data-testid="assign-to-staff"><UsersThree size={18} aria-hidden="true" />Assign to Staff</Link></li>
                  ) : null}
                  <li>
                    {canCompare ? (
                      <Link className="reader-action" href={`${back}/compare`} data-testid="compare-versions"><GitDiff size={18} aria-hidden="true" />Compare Versions</Link>
                    ) : (
                      <span className="reader-action" aria-disabled="true" title="This policy has only one version"><GitDiff size={18} aria-hidden="true" />Compare Versions<span className="ml-auto text-[11.5px]">One version</span></span>
                    )}
                  </li>
                  <li><Link className="reader-action" href={`${back}?view=history`}><ClockCounterClockwise size={18} aria-hidden="true" />View Version History</Link></li>
                </ul>
              </section>
              <section className="hb-pn hb-c-purple" aria-labelledby="reader-forms-title" data-testid="linked-resources">
                <div className="hb-pn-h">
                  <h2 id="reader-forms-title">Linked Forms &amp; Resources</h2>
                  {forms.length ? <span className="hb-pn-cnt">{forms.length}</span> : null}
                </div>
                <div className="px-3.5 pb-3 pt-1">
                {forms.length ? (
                  <ul className="mt-2 divide-y divide-[#f2f4f7]">
                    {forms.slice(0, 6).map((f) => (
                      <li key={f.id} className="flex items-start gap-2.5 py-2.5">
                        <FileDoc size={22} className="mt-0.5 shrink-0 text-[#2b579a]" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <Link href={`/policies/${f.id}`} className="block truncate text-[13.5px] font-medium no-underline hover:underline" title={f.title}>{f.title}</Link>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#667085]"><span className="rounded-full bg-[#f1ecfc] px-1.5 font-semibold leading-[18px] text-module-strong">{f.typeLabel}</span>{f.ref}{f.uses.filter((u) => u.placement?.step).map((u) => <a key={u.linkId} href={`#${u.placement!.sectionKey}`}>Step {u.placement!.step}</a>)}</span>
                        </div>
                        <span className="flex shrink-0 gap-0.5">
                          <a href={`/api/policies/${f.id}/download?format=docx`} download className="flex h-8 w-8 items-center justify-center rounded-[7px] !text-[#475467] hover:bg-module/[.08]" aria-label={`Download ${f.title} as Word`} title="Download Word"><DownloadSimple size={17} aria-hidden="true" /></a>
                          <Link href={`/policies/${f.id}`} className="flex h-8 w-8 items-center justify-center rounded-[7px] !text-[#475467] hover:bg-module/[.08]" aria-label={`Open ${f.title}`} title="Open"><ArrowSquareOut size={17} aria-hidden="true" /></Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-[13px] text-[#667085]">{isPolicy ? "No forms are linked to this policy yet." : "This is itself a resource; see the policies it supports below."}</p>}
                {forms.length > 6 ? <a href="#forms" className="mt-1 block text-[13px]">All {forms.length} forms and resources</a> : null}
                {workflows.length ? (
                  <div className="mt-2 border-t border-[#f2f4f7] pt-2.5">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#667085]">Open in CSB Care</p>
                    <ul className="mt-1">{workflows.map((w) => <li key={w.href}><Link className="reader-action !px-1.5 !py-1.5 text-[13.5px]" href={w.href}><ClipboardText size={17} aria-hidden="true" />{w.label}</Link></li>)}</ul>
                  </div>
                ) : null}
                </div>
              </section>
            </aside>
          </div>
        </PolicyReader>
      ) : (
        <section className="pc-panel mt-3 p-5" aria-label={viewLinks.find((l) => l.key === view)?.label}>
          {view === "history" ? (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-2xl text-sm text-slate-600">Published versions are never overwritten. Restoring an earlier version creates a new draft, which is published as a new version.</p>
                {canCompare ? <Link className="btn-secondary" href={`${back}/compare`}><GitDiff size={16} aria-hidden="true" />Compare versions</Link> : null}
              </div>
              <Timeline testId="version-history">
                {p.versions.map((ver, i) => {
                  const count = ver.approvals.filter((a) => a.decision === "APPROVE").length;
                  const live = ver.status === "PUBLISHED";
                  const draft = !["PUBLISHED", "SUPERSEDED", "ARCHIVED"].includes(ver.status);
                  return (
                    <TimelineItem
                      key={ver.id}
                      last={i === p.versions.length - 1}
                      mark={live ? "current" : draft ? "pending" : "past"}
                      when={fmtDate(ver.publishedAt ?? ver.createdAt)}
                      title={<span className="flex flex-wrap items-center gap-2"><Link href={`/policies/${p.id}/versions/${ver.id}`} className="text-[16px] font-semibold text-navy-900">Version {ver.label}</Link><StatusBadge status={ver.status} /></span>}
                      aside={
                        <div className="flex flex-col items-start gap-2 sm:items-end">
                          {ver.revisionAsDraft && draft && canOpenDraft(ctx, p.kind) ? <Link href={`/revisions/${ver.revisionAsDraft.id}`} className="btn-secondary px-2.5 py-1 text-xs">Open draft</Link> : null}
                          {i < p.versions.length - 1 ? <Link href={`${back}/compare?from=${p.versions[i + 1]!.id}&to=${ver.id}`} className="text-xs">Compare with previous</Link> : null}
                          {canAuthor && ver.status === "SUPERSEDED" ? (
                            <form action={rollbackAction} className="flex gap-1">
                              <input type="hidden" name="policyId" value={p.id} />
                              <input type="hidden" name="versionId" value={ver.id} />
                              <input type="hidden" name="back" value={`${back}?view=history`} />
                              <input className="input w-36 py-1 text-xs" name="reason" placeholder="Reason" required aria-label="Rollback reason" />
                              <button className="btn-secondary px-2.5 py-1 text-xs" type="submit">Restore</button>
                            </form>
                          ) : null}
                        </div>
                      }
                    >
                      <p>{ver.changeSummary ?? ver.reasonForChange ?? "No summary recorded."}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {ORIGIN[ver.origin] ?? ver.origin}{draft ? "" : ` · published by ${versionPublisher(ver)}`}{count ? ` · ${count} review approval${count === 1 ? "" : "s"} recorded earlier` : ""}
                      </p>
                    </TimelineItem>
                  );
                })}
              </Timeline>
            </>
          ) : null}

          {view === "requirements" ? (
            links.length ? (
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
                              <div className="mt-0.5 text-xs text-slate-500">{l.requirement.exactReference} · {l.sectionKey ? <>covered in {v?.sections.find((s) => s.key === l.sectionKey)?.heading ?? l.sectionKey}</> : "covered by the whole policy"}</div>
                            </div>
                            <div className="text-xs sm:text-right"><Verification status={l.requirement.verificationStatus} /></div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </>
            ) : <Empty>No requirements mapped to this document yet.</Empty>
          ) : null}

          {view === "publications" ? (
            p.publications.length ? (
              <ul className="border-t-2 border-navy-900">
                {p.publications.map((pub) => {
                  const done = pub.acknowledgements.filter((a) => a.acknowledgedAt).length;
                  const total = pub.acknowledgements.length;
                  const pct = total ? Math.round((done / total) * 100) : 0;
                  return (
                    <li key={pub.id} className="grid gap-x-8 gap-y-3 border-b border-slate-200 py-5 md:grid-cols-[minmax(0,1fr)_18rem]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={pub.status} /><span className="text-[16px] font-semibold text-navy-900">{pub.status === "SCHEDULED" ? "Scheduled for" : "Published"} {fmtDate(pub.publishedAt ?? pub.scheduledFor)}</span></div>
                        {pub.implementationConfirmedAt ? (
                          <p className="mt-2 flex items-start gap-1.5 text-sm text-emerald-800"><CheckCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />Implementation confirmed {fmtDate(pub.implementationConfirmedAt)}: {pub.implementationNotes}</p>
                        ) : pub.status === "PUBLISHED" && pub.organisationId && hasOrgPermission(ctx, "implementation.confirm") ? (
                          <form action={confirmImplementationAction} className="mt-3 flex max-w-lg gap-2">
                            <input type="hidden" name="publicationId" value={pub.id} />
                            <input type="hidden" name="back" value={`${back}?view=publications`} />
                            <input className="input py-1.5 text-sm" name="notes" placeholder="How was it put into practice?" required aria-label="Implementation notes" />
                            <button className="btn-secondary shrink-0 py-1.5">Confirm implemented</button>
                          </form>
                        ) : null}
                      </div>
                      {pub.requiresAcknowledgement ? (
                        <div>
                          <div className="flex items-baseline justify-between text-xs text-slate-600"><span>Read and signed</span><span className="font-mono">{done} of {total}</span></div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Acknowledgements">
                            <div className={`h-full ${pct === 100 ? "bg-emerald-600" : "bg-module"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      ) : <p className="text-xs text-slate-500">No acknowledgement requested.</p>}
                    </li>
                  );
                })}
              </ul>
            ) : <Empty>Not yet published.</Empty>
          ) : null}

          {view === "flags" ? (
            flags ? (
              <ul className="border-t-2 border-navy-900">
                {p.candidates.map((c) => (
                  <li key={c.id} className="border-b border-slate-200 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/changes/${c.changeId}`} className="text-[16px] font-semibold text-navy-900">{c.change.title.replace(/^SIMULATED:\s*/, "")}</Link>
                      <SimulatedBadge show={c.change.isSimulated} />
                    </div>
                    <p className="mt-1 text-sm text-slate-600"><span className="text-slate-800">{c.reason.replace(/_/g, " ").toLowerCase().replace(/^./, (ch) => ch.toUpperCase())}.</span> {c.evidence.slice(0, 220)}{c.evidence.length > 220 ? "…" : ""}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty>No detected regulatory change has flagged this document.</Empty>
          ) : null}
        </section>
      )}
    </div>
  );
}

// ── Document parts ──

const PART_ICON: Record<ReaderPartId, React.ReactNode> = {
  purpose: <Target />,
  scope: <MapPin />,
  objectives: <ListChecks />,
  policy: <FileText />,
  procedure: <ListNumbers />,
  definitions: <Translate />,
  "keyfacts-staff": <Lightbulb />,
  "keyfacts-service-users": <UserList />,
  monitoring: <ShieldCheck />,
  appendices: <MapPin />,
  "further-reading": <Books />,
  "outstanding-practice": <Sparkle />,
  about: <Info />,
  use: <ListChecks />,
  content: <FileText />,
  questions: <ListNumbers />,
  local: <MapPin />,
};

type Details = Awaited<ReturnType<typeof businessDetails>> | null;
type Section = ReaderPart["sections"][number];

function PartSection({ part, number, children }: { part: ReaderPart; number: number; children: React.ReactNode }) {
  return (
    <section id={part.id} className="reader-section" aria-labelledby={`h-${part.id}`} data-testid={`part-${part.id}`}>
      <h2 id={`h-${part.id}`} tabIndex={-1} data-reader-heading className="reader-h2"><span className="num">{number}</span>{part.label}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PartBody({ part, procedure, details, canEdit, framework, reading, related, stepForms }: {
  part: ReaderPart;
  procedure: Section[];
  details: Details;
  canEdit: boolean;
  framework: ReturnType<typeof parseFramework>;
  reading: { id: string; title: string; sourceUrl: string; exactReference: string; verificationStatus: string }[];
  related: { id: string; ref: string; title: string }[];
  stepForms: Map<string, StepForm[]>;
}) {
  if (part.derived) {
    return (
      <>
        <p className="mb-3 text-[13.5px] text-[#667085]">The first point of each procedure step. A written staff summary has not been added to this policy yet.</p>
        <ul className="space-y-2.5">
          {procedure.map((s) => <li key={s.key} className="flex gap-2.5 text-[15px] leading-7 text-[#1d2939]"><Lightbulb size={17} weight="fill" className="mt-1.5 shrink-0 text-[#7a5ac9]" aria-hidden="true" /><span><TagText text={firstSentence(s.body)} details={details} canEdit={canEdit} /></span></li>)}
        </ul>
      </>
    );
  }
  const single = part.sections.length === 1 && (part.sections[0]!.heading === part.label || part.id === "purpose" || part.id === "scope");
  let step = 0;
  return (
    <div className="space-y-7">
      {part.sections.map((s) => {
        if (part.id === "procedure" && s.key.startsWith("procedure.")) {
          step += 1;
          return (
            <div key={s.key} id={s.key} className="reader-step" data-testid={`step-${s.key}`}>
              <span className="reader-step-num" aria-hidden="true">{step}</span>
              <h3 className="reader-h3 self-center"><span className="sr-only">Step {step}: </span>{s.heading}</h3>
              <TagBody body={s.body} details={details} canEdit={canEdit} className="reader-body col-start-2" />
              <StepForms items={stepForms.get(s.key)} />
            </div>
          );
        }
        if (s.key === "framework") {
          return (
            <div key={s.key} id={s.key}>
              <h3 className="reader-h3">{s.heading}</h3>
              <FrameworkLists framework={framework} />
            </div>
          );
        }
        if (s.key === "related") {
          return (
            <div key={s.key} id={s.key}>
              <h3 className="reader-h3">{s.heading}</h3>
              <RelatedList related={related} />
            </div>
          );
        }
        return (
          <div key={s.key} id={part.sections.length > 1 ? s.key : undefined}>
            {single ? null : <h3 className="reader-h3">{s.heading}{s.isLocal ? <Badge tone="teal">local</Badge> : null}</h3>}
            <TagBody body={s.body} details={details} canEdit={canEdit} className={`reader-body ${single ? "" : "mt-1.5"}`} />
          </div>
        );
      })}
      {part.id === "further-reading" && reading.length ? (
        <div>
          <h3 className="reader-h3">Official sources</h3>
          <ul className="mt-2 space-y-2 text-[14.5px] leading-5">
            {reading.map((r) => <li key={r.id}><a href={r.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1.5"><ArrowSquareOut size={14} className="mt-[3px] shrink-0" aria-hidden="true" />{r.title}<span className="sr-only"> (opens in a new tab)</span></a><span className="block pl-5 text-[12.5px] text-[#667085]">{r.exactReference} · <Verification status={r.verificationStatus} /></span></li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function FrameworkLists({ framework }: { framework: ReturnType<typeof parseFramework> }) {
  const groups: [string, string[]][] = [["Legal and regulatory requirements", framework.legal], ["Guidance", framework.guidance], ["CQC quality statements", framework.qs]];
  return (
    <div className="mt-2 space-y-3">
      {groups.filter(([, l]) => l.length).map(([label, list]) => (
        <div key={label}>
          <p className="text-[13px] font-semibold text-[#475467]">{label}</p>
          <ul className="ml-5 mt-1 list-disc space-y-1 text-[15px] leading-6 text-[#1d2939] marker:text-[#7a5ac9]">{list.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      ))}
      <p className="text-[12.5px] text-[#667085]">These references are CSB summaries for orientation, not quotations. Check them against the current official text before approval.</p>
    </div>
  );
}

type StepForm = LinkedResource & { use: ResourceUse; startId: string | null };

/** Starts an on-screen copy of a form; shown only for forms that can be filled in on screen. */
function StartForm({ definitionId, back }: { definitionId: string; back: string }) {
  return (
    <form action={startFormAction}>
      <input type="hidden" name="definitionId" value={definitionId} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" className="btn-primary !min-h-0 px-2.5 py-1 text-xs">Fill in on screen</button>
    </form>
  );
}

/** Where a linked form is used, and why, under its name in the Forms & Resources table. */
function LinkMeta({ f }: { f: LinkedResource }) {
  const lines = f.uses.filter((u) => u.placement || u.placementMissing || u.useWhen);
  if (!lines.length && f.source === "LINK") return null;
  return (
    <span className="mt-0.5 block text-[12.5px] leading-5 text-[#475467]" data-testid={`form-meta-${f.ref}`}>
      {lines.map((u) => (
        <span key={u.linkId} className="block">
          {u.placement ? <>Used at <a href={`#${u.placement.sectionKey}`}>{u.placement.step ? `Step ${u.placement.step}: ${u.placement.heading}` : u.placement.heading}</a>{u.useWhen ? " · " : null}</> : null}
          {u.placementMissing ? <>Its step is not in this version{u.useWhen ? " · " : null}</> : null}
          {u.useWhen ? <>Use when {u.useWhen}</> : null}
        </span>
      ))}
      {f.source === "TEXT" ? <span className="block italic">Named in the form&rsquo;s Related policies</span> : null}
    </span>
  );
}

/** A discreet note inside a procedure step naming the form to use at that step. */
function StepForms({ items }: { items?: StepForm[] }) {
  if (!items?.length) return null;
  return (
    <div className="col-start-2 mt-3 rounded-[10px] border border-[#e9e3fb] bg-module/[.04] px-3.5 py-2.5" data-testid="step-forms">
      <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-module">{items.length === 1 ? "Form for this step" : "Forms for this step"}</p>
      <ul className="mt-1 space-y-1.5">
        {items.map((f) => (
          <li key={f.use.linkId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
            <span className="flex min-w-0 flex-1 basis-[16rem] items-start gap-2">
              <FileDoc size={18} className="mt-0.5 shrink-0 text-[#2b579a]" aria-hidden="true" />
              <span className="min-w-0">
                <Link href={`/policies/${f.id}`} className="font-medium no-underline hover:underline">{f.title}</Link>
                <span className="text-[#667085]"> · {f.ref}</span>
                {f.use.required ? <span className="ml-1.5 rounded-full bg-[#fef3f2] px-1.5 text-[11.5px] font-semibold leading-[18px] text-[#b42318]">Required</span> : null}
                {f.use.useWhen ? <span className="block text-[13px] text-[#475467]">Use when {f.use.useWhen}</span> : null}
              </span>
            </span>
            <span className="flex gap-1.5">
              {f.startId ? <StartForm definitionId={f.startId} back="/policies/forms/records" /> : null}
              <a className="btn-secondary !min-h-0 px-2.5 py-1 text-xs" href={`/api/policies/${f.id}/download?format=docx`} download aria-label={`Download ${f.title} as Word`}><FileDoc size={14} aria-hidden="true" />Word</a>
              <a className="btn-secondary !min-h-0 px-2.5 py-1 text-xs" href={`/api/policies/${f.id}/download?format=pdf`} download aria-label={`Download ${f.title} as PDF`}><FilePdf size={14} aria-hidden="true" />PDF</a>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RelatedList({ related }: { related: { id: string; ref: string; title: string }[] }) {
  if (!related.length) return <p className="mt-2 text-[14px] text-[#667085]">No related policies recorded.</p>;
  return (
    <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
      {related.map((r) => <li key={r.id} className="flex gap-3 border-b border-[#f2f4f7] py-2 text-[14px]"><span className="w-[108px] shrink-0 whitespace-nowrap text-[#667085]">{r.ref}</span><Link href={`/policies/${r.id}`} className="font-medium no-underline hover:underline">{r.title}</Link></li>)}
    </ul>
  );
}

// ── Review sheet helpers ──

function Fact({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "rose" | "amber" | "green" | "blue" }) {
  const colour = tone === "rose" ? "text-[#b42318]" : tone === "amber" ? "text-[#b54708]" : tone === "green" ? "text-[#067647]" : tone === "blue" ? "text-[#175cd3]" : "text-[#101828]";
  return (
    <div className="reader-fact">
      <span aria-hidden="true">{icon}</span>
      <div className="min-w-0"><p className="text-[12px] text-[#667085]">{label}</p><p className={`text-[14px] font-semibold leading-5 ${colour}`}>{value}</p></div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <tr><th scope="row">{label}</th><td>{children}</td></tr>;
}

function NotAssigned() {
  return <span className="text-[#667085]">Not assigned</span>;
}

const SERVICE_NAMES: Record<string, string> = {
  RESIDENTIAL: "residential care homes",
  NURSING: "care homes with nursing",
  DOMICILIARY: "domiciliary (home) care",
  SUPPORTED_LIVING: "supported living",
};

function scopeLine(mode: string, branches: string[]) {
  if (mode === "BRANCH_SPECIFIC") return `Branch: ${branches.join(", ") || "not recorded"}`;
  if (mode === "SHARED_WITH_APPENDICES") return `All branches${branches.length ? `, with a local appendix for ${branches.join(", ")}` : ""}`;
  return "All branches";
}

/** Existing CSB Care workflows a policy's staff record things in, offered only to people allowed to use them. */
function digitalWorkflows(category: string, ctx: Parameters<typeof hasOrgPermission>[0]) {
  const out: { label: string; href: string }[] = [];
  if (["SAFEGUARDING", "INCIDENTS", "CANDOUR", "HEALTH_SAFETY", "MEDICINES", "COMPLAINTS"].includes(category) && hasOrgPermission(ctx, "incident.report")) out.push({ label: "Report an incident", href: "/rota/incidents/new" });
  if (["RISK", "HEALTH_SAFETY", "CARE", "HOME_CARE", "SAFEGUARDING"].includes(category) && hasOrgPermission(ctx, "care.plan.edit")) out.push({ label: "Start a risk assessment", href: "/rota/risks/new" });
  if (["GOVERNANCE", "INCIDENTS", "COMPLAINTS", "RISK"].includes(category) && hasOrgPermission(ctx, "action.manage")) out.push({ label: "Corrective actions", href: "/actions" });
  if (["GOVERNANCE", "RISK"].includes(category) && hasOrgPermission(ctx, "risk.view")) out.push({ label: "Risk register", href: "/compliance/risks" });
  return out;
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

function ImpactBars({ level }: { level: number }) {
  const fill = level === 3 ? "#d92d20" : level === 2 ? "#f79009" : "#17b26a";
  return (
    <svg role="img" aria-label={`${["Low", "Medium", "High"][level - 1]} impact`} width="36" height="26" viewBox="0 0 30 22">
      {[0, 1, 2].map((i) => <rect key={i} x={2 + i * 8} y={15 - i * 6.5} width="5" height={7 + i * 6.5} rx="1" fill={i < level ? fill : "#e4e7ec"} />)}
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
  MASTER_SYNC: "CSB central update",
  ROLLBACK: "Restored from an earlier version",
};

function VersionState({ version, starter }: { version: { label: string; publishedAt: Date | null } | null; starter: boolean }) {
  if (!version) return <span className="reader-pill bg-[#fffaeb] text-[#b54708]" data-testid="reader-status"><span aria-hidden="true" className="h-2 w-2 rounded-full border-2 border-current" />Not published</span>;
  return <span className="reader-pill bg-[#ecfdf3] text-[#067647]" data-testid="reader-status"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />{starter ? "Published · CSB starter text" : `Published ${fmtDate(version.publishedAt)}`}</span>;
}

function Verification({ status }: { status: string }) {
  if (status === "VERIFIED") return <span className="text-[12.5px] text-[#067647]">Checked against source</span>;
  if (status === "NEEDS_REVIEW") return <span className="text-[12.5px] font-medium text-[#b42318]">Needs review</span>;
  return <span className="text-[12.5px] text-[#b54708]">Not yet verified</span>;
}
