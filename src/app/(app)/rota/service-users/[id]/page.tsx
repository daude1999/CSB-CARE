import Link from "@/components/link";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, dbDate, fmtLondonDate, fromDbDate, hhmm, londonDate, londonTime, mondayOf, WEEKDAYS } from "@/lib/london";
import { preferredOf } from "@/lib/carer-places";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { getServiceUser, nextStatuses, revealKeySafe } from "@/server/care/service-users";
import { packageCoverage, packageHistory, packageReviewItems, packageSources } from "@/server/care/packages";
import { carePackageSummary } from "@/server/care/package-view";
import { CarePackageSummaryCard } from "@/components/su-care-package-summary";
import { CarePackageTab } from "@/components/su-care-package-tab";
import { ServiceUserAiAudit } from "@/components/coordinator/su-ai-audit";
import { listMedications, medicationEnabled } from "@/server/care/medication";
import { recentIncidentsFor } from "@/server/care/incidents";
import { IncidentStatusBadge, SeverityBadge } from "@/components/incident-ui";
import { listRisks, RISK_TYPE_LABEL, REVIEW_STATE_LABEL, reviewState } from "@/server/care/risks";
import { serviceUserCompliance, serviceUserVisitNotes } from "@/server/care/su-records";
import { NOTE_LABEL } from "@/server/care/visit-record";
import { ServiceUserCompliance } from "@/components/su-compliance";
import { LEVEL } from "@/components/risk-fields";
import { MedicationList, MedicationOff } from "@/components/medication-ui";
import { serviceUserGlance } from "@/server/care/glance";
import { memberNames, rotaLookups, suName } from "@/server/rota/queries";
import { listTemplates } from "@/server/rota/templates";
import { rotaSettings } from "@/server/rota/settings";
import { parseSuRotaFilter, serviceUserRota, suRotaWeek } from "@/server/rota/su-rota";
import { parseList, ServiceUserTemplateTab } from "@/components/su-template-tab";
import { ServiceUserRotaTab } from "@/components/su-rota-tab";
import { futureRotaDefaults, ServiceUserFutureRota } from "@/components/su-future-rota";
import { previewServiceUserRota } from "@/server/rota/build";
import { addAbsenceAction, addContactAction, cancelAbsenceAction, carerPreferenceAction, keySafeAction, removeCarerPreferenceAction, removeContactAction, updateContactAction, serviceUserStatusAction, updateServiceUserAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Field, Flash, fmtDate } from "@/components/ui";
import { DataTable, Panel as HbPanel, PanelAction, StatusPill } from "@/components/harbour/ui";
import { KeyValueList, Masked, QuickLinks, RecordContextBar, RecordHeader, RecordTabs, Timeline, type RecordAlert, type TimelineEntry } from "@/components/harbour/record";
import { Archive, ArrowsClockwise, CalendarBlank, ChatText, Check, CheckCircle, ClipboardText, ClockCounterClockwise, FileText, Heart, House, IdentificationCard, Key, MagnifyingGlass, PencilSimple, PersonSimple, Phone, Pill, Plus, ShieldWarning, UploadSimple, User, UsersThree, Warning } from "@phosphor-icons/react/dist/ssr";
import { CarerSlots, VisitStatusBadge } from "@/components/rota-ui";
import { MissedHistory } from "@/components/missed-history";
import { ServiceUserForm } from "@/components/service-user-form";
import { AUTHORITY_LABEL, PREFERRED_LABEL } from "@/server/rota/cover-communication";
import { ServiceUserDocuments } from "@/components/su-documents";
import { DischargeReviews } from "@/components/discharge-reviews";
import { listDischargeReviews } from "@/server/care/discharge-review";
import { BodyMapSection } from "@/components/body-map";
import { CallNotesSection } from "@/components/call-notes";
import { listCallNotes } from "@/server/care/call-notes";
import { ServiceUserReferenceNumbers } from "@/components/su-reference-numbers";

import { PersonForms } from "@/components/forms/person-forms";
import { formsForServiceUser } from "@/server/forms/record-links";
export const dynamic = "force-dynamic";

const CONTACT_LABEL: Record<string, string> = { NEXT_OF_KIN: "Next of kin", FAMILY: "Family", LPA_HEALTH: "LPA (health and welfare)", LPA_FINANCE: "LPA (property and finance)", GP: "GP", PHARMACY: "Pharmacy", SOCIAL_WORKER: "Social worker", DISTRICT_NURSE: "District nurse", OTHER: "Other" };
const TABS = [["overview", "Overview"], ["care-plans", "Care plans"], ["risks", "Risk assessments"], ["incidents", "Incidents"], ["visits", "Visits"], ["template", "Template"], ["rota", "Rota"], ["notes", "Visit notes"], ["package", "Care package"], ["medication", "Medication"], ["people", "Contacts & carers"], ["details", "Personal details"], ["references", "Reference Numbers"], ["missed", "Missed calls"], ["documents", "Documents"], ["bodymap", "Body map"], ["call-notes", "Call Notes"], ["ai-audit", "Audit & Exceptions"], ["history", "History"]] as const;
type TabKey = (typeof TABS)[number][0];
/**
 * The profile's sections, grouped so the bar stays short: each group opens its first section, and a group with more
 * than one shows them as a second row. A group is hidden when none of its sections may be opened. Other sections
 * (documents, body map) join their group by key.
 */
const GROUPS: { label: string; tabs: string[] }[] = [
  { label: "Overview", tabs: ["overview"] },
  { label: "Personal details", tabs: ["details"] },
  { label: "Reference Numbers", tabs: ["references"] },
  { label: "Care", tabs: ["care-plans", "risks", "package", "medication"] },
  { label: "Health and safety", tabs: ["incidents", "bodymap"] },
  { label: "Visits", tabs: ["visits", "template", "rota", "notes", "missed"] },
  { label: "Documents", tabs: ["documents"] },
  { label: "Contacts & carers", tabs: ["people"] },
  { label: "Call Notes", tabs: ["call-notes"] },
  { label: "Audit & Exceptions", tabs: ["ai-audit"] },
  { label: "History", tabs: ["history"] },
];
const REVIEW_TONE = { OVERDUE: "rose", DUE_SOON: "amber", IN_DATE: "green" } as const;

export default async function ServiceUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("serviceUser.view");
  const su = await orNotFound(getServiceUser(ctx, id));
  const canReportIncident = hasOrgPermission(ctx, "incident.report");
  const canNotes = hasOrgPermission(ctx, "rota.view");
  const canCallNotes = hasOrgPermission(ctx, "callNote.view");
  // Audit & Exceptions shows what CSB AI did with documents; the same people who run intakes see it.
  const canAiAudit = hasOrgPermission(ctx, "serviceUser.edit") && hasOrgPermission(ctx, "rota.edit") && hasOrgPermission(ctx, "serviceUser.documents");
  const availableTabs = TABS.filter(([key]) => (key !== "incidents" || canReportIncident) && (key !== "notes" || canNotes) && ((key !== "template" && key !== "rota") || canNotes) && (key !== "call-notes" || canCallNotes) && (key !== "ai-audit" || canAiAudit));
  const tab: TabKey = availableTabs.find(([k]) => k === sp.tab)?.[0] ?? "overview";
  const tabLabel = new Map<string, string>(availableTabs);
  const groups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((t) => tabLabel.has(t)) })).filter((g) => g.tabs.length);
  const group = groups.find((g) => g.tabs.includes(tab)) ?? groups[0]!;
  // An archived record is read-only: its edit controls are hidden (and the server refuses detail and status changes).
  const canEdit = hasOrgPermission(ctx, "serviceUser.edit") && !su.archivedAt;
  const canArchive = hasOrgPermission(ctx, "serviceUser.archive") || hasOrgPermission(ctx, "serviceUser.delete");
  const canKeySafe = hasOrgPermission(ctx, "serviceUser.keysafe");
  const base = `/rota/service-users/${su.id}`;
  const back = `${base}?tab=${tab}`;
  let keySafe: string | null = null;
  let keySafeError: string | null = null;
  if (sp.reveal === "keysafe" && canKeySafe) {
    try {
      keySafe = await revealKeySafe(ctx, su.id);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      keySafeError = e.message;
    }
  }
  const today = londonDate();
  const canFund = hasOrgPermission(ctx, "finance.manage");
  const [lk, visits, history, coverage, funders] = await Promise.all([
    rotaLookups(ctx),
    tab === "visits" || tab === "overview"
      ? db.visit.findMany({ where: { serviceUserId: su.id, organisationId: su.organisationId, date: { gte: dbDate(tab === "visits" ? addDays(today, -14) : [mondayOf(today), addDays(today, -7)].sort()[0]!), lte: dbDate(addDays(today, 14)) } }, orderBy: { scheduledStart: "asc" }, include: { callType: { select: { name: true } }, assignments: { where: { removedAt: null }, select: { slot: true, position: true, reviewReason: true, staff: { select: { id: true, displayName: true } } } } } })
      : Promise.resolve([]),
    tab === "history" || tab === "overview" ? db.auditLog.findMany({ where: { organisationId: su.organisationId, entityType: "ServiceUser", entityId: su.id }, orderBy: { createdAt: "desc" }, take: tab === "history" ? 50 : 8 }) : Promise.resolve([]),
    tab === "overview" || tab === "package" ? packageCoverage(su.organisationId, su.id) : Promise.resolve(null),
    tab === "package" && canFund ? db.funder.findMany({ where: { organisationId: su.organisationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const discharge = tab === "overview" ? await listDischargeReviews(ctx, su.id) : null;
  // The Overview's timeline shows the newest Call Notes the viewer may open (the Call Notes tab's own list, page 1).
  const callNotes = tab === "overview" && canCallNotes ? await listCallNotes(ctx, su.id) : null;
  const [glance, compliance] = tab === "overview" ? await Promise.all([serviceUserGlance(ctx, su), serviceUserCompliance(ctx, su)]) : [null, []];
  // Care package: the Overview card needs only the open-question count; the tab needs the questions, sources and history.
  const [pkgReviews, pkgSources, pkgHistory] = await Promise.all([
    tab === "overview" || tab === "package" ? packageReviewItems(ctx, su.id) : Promise.resolve(null),
    tab === "package" ? packageSources(ctx, su.id) : Promise.resolve(null),
    tab === "package" ? packageHistory(ctx, su.id) : Promise.resolve([]),
  ]);
  // The person owns these records. Only load what the selected profile section needs.
  const [plans, risks, archivedRisks, incidents, notes] = await Promise.all([
    tab === "care-plans" || tab === "overview"
      ? db.carePlan.findMany({ where: { serviceUserId: su.id, organisationId: su.organisationId }, select: { id: true, version: true, status: true, reviewDue: true, approvedAt: true }, orderBy: { version: "desc" } })
      : Promise.resolve([]),
    tab === "risks" || tab === "overview" ? listRisks(ctx, { serviceUserId: su.id }) : Promise.resolve([]),
    tab === "risks" ? listRisks(ctx, { serviceUserId: su.id, archived: true }) : Promise.resolve([]),
    tab === "incidents" ? recentIncidentsFor(ctx, su.id, 100) : tab === "overview" ? recentIncidentsFor(ctx, su.id, 5) : Promise.resolve(null),
    tab === "notes" ? serviceUserVisitNotes(ctx, su.id, { category: sp.category, days: Number(sp.days) || undefined, q: sp.q?.trim().slice(0, 100) || undefined }) : Promise.resolve(null),
  ]);
  // Visits -> Template and Rota read the same template and visit records as Daily Templates and the Daily Rota.
  // On-screen forms linked to this person, only those the viewer may open (Forms PR 4).
  const suForms = tab === "documents" && sp.section === "forms" ? await formsForServiceUser(ctx, su.id) : null;
  const cycleLength = tab === "template" ? (await rotaSettings(db, su.organisationId)).cycleLength : 4;
  const tplWeeks = parseList(sp.weeks, cycleLength);
  const tplDays = parseList(sp.days, 7);
  const [suTemplates, suRota] = await Promise.all([
    tab === "template" ? listTemplates(ctx, { serviceUserId: su.id, state: "all", weeks: tplWeeks, days: tplDays }) : Promise.resolve(null),
    tab === "rota" ? serviceUserRota(ctx, su.id, suRotaWeek(sp.week), parseSuRotaFilter(sp.status)) : Promise.resolve(null),
  ]);
  // Create Future Rota (Rota tab, ?future=1): previewed on the server, created only from the Create button.
  const canBuild = hasOrgPermission(ctx, "rota.build");
  const future = tab === "rota" && sp.future && canBuild ? futureRotaDefaults(sp, suRotaWeek(sp.week), mondayOf(today)) : null;
  let futurePreview: Awaited<ReturnType<typeof previewServiceUserRota>> | null = null;
  let futureError: string | null = null;
  if (future) {
    try {
      futurePreview = await previewServiceUserRota(ctx, su.id, { weekStart: future.from, weeks: future.weeks });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      futureError = e.message;
    }
  }
  const todayDb = dbDate(today);
  const names = await memberNames(ctx, [...history, ...pkgHistory].map((h) => h.actorId));
  const staffName = new Map(lk.staff.map((s) => [s.id, s.displayName]));
  const active = su.packages.find((p) => p.status === "ACTIVE") ?? null;

  const fullName = `${su.firstName} ${su.lastName}`;
  const initials = `${su.firstName.charAt(0)}${su.lastName.charAt(0)}`.toUpperCase();
  const ref = su.csbReference ?? su.reference;
  // Sensitive identifiers: only for people with sensitive access (the server sends nothing otherwise), and even then
  // only in the page after "Show" (?show=dob, nhs or address). Nothing masked is written into the HTML.
  const shown = new Set((sp.show ?? "").split(",").filter(Boolean));
  const showHref = (k: string) => { const q = new URLSearchParams({ tab, show: [...shown, k].join(",") }); return `${base}?${q}`; };
  const hideHref = (k: string) => { const rest = [...shown].filter((x) => x !== k); const q = new URLSearchParams(rest.length ? { tab, show: rest.join(",") } : { tab }); return `${base}?${q}`; };
  const dobYear = su.dateOfBirth ? su.dateOfBirth.getUTCFullYear() : null;
  const age = su.dateOfBirth ? Math.floor((Date.parse(`${today}T00:00:00Z`) - su.dateOfBirth.getTime()) / (365.2425 * 86_400_000)) : null;
  const dob = su.sensitiveHidden ? <span className="text-[var(--hb-ink-3)]">Restricted</span>
    : su.dateOfBirth ? <Masked shown={shown.has("dob")} value={<>{fmtDate(su.dateOfBirth)} ({age} years)</>} mask={<>•• •• {dobYear} ({age} years)</>} showHref={showHref("dob")} hideHref={hideHref("dob")} label="date of birth" /> : "—";
  const nhs = su.sensitiveHidden ? <span className="text-[var(--hb-ink-3)]">Restricted</span>
    : su.nhsNumber ? <Masked shown={shown.has("nhs")} value={su.nhsNumber} mask={<>••• ••• {su.nhsNumber.replace(/\s/g, "").slice(-4)}</>} showHref={showHref("nhs")} hideHref={hideHref("nhs")} label="NHS number" /> : "—";
  const addressText = [su.addressLine1, su.addressLine2, su.town, su.postcode].filter(Boolean).join(", ");
  const address = !addressText ? "—" : su.sensitiveHidden ? addressText
    : <Masked shown={shown.has("address")} value={addressText} mask={<>•••• {su.postcode ?? ""}</>} showHref={showHref("address")} hideHref={hideHref("address")} label="home address" />;
  const statusTone = su.status === "ACTIVE" ? "ok" : su.status === "PAUSED" ? "warn" : su.status === "ENDED" ? "neutral" : "progress";
  const statusLabel = su.status.charAt(0) + su.status.slice(1).toLowerCase().replaceAll("_", " ");
  const tabHref = (t: string) => `${base}?tab=${t}`;

  // Visits on the Overview: this week (Monday to Sunday), the last seven days and the next fourteen.
  const monday = mondayOf(today);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const dayOf = (v: (typeof visits)[number]) => fromDbDate(v.date);
  const placesFilled = (v: (typeof visits)[number]) => v.assignments.filter((a) => a.slot !== "SHADOW").length;
  const ini = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w.charAt(0)).join("").slice(0, 2).toUpperCase();
  const completed = visits.filter((v) => v.status === "COMPLETED" && dayOf(v) <= today).sort((a, b) => b.scheduledStart.getTime() - a.scheduledStart.getTime());
  const upcoming = visits.filter((v) => dayOf(v) >= today && v.status !== "CANCELLED");
  const upcomingDays = [...new Set(upcoming.map(dayOf))].sort();
  const weekVisits = visits.filter((v) => weekDays.includes(dayOf(v)) && v.status !== "CANCELLED");
  const weekCalls = [...new Map(weekVisits.slice().sort((a, b) => (a.scheduledStart.getTime() % 86_400_000) - (b.scheduledStart.getTime() % 86_400_000)).map((v) => [v.callType.name, v.callType.name])).keys()];
  const activePlan = plans.find((pl) => pl.status === "ACTIVE") ?? plans[0] ?? null;

  // The timeline: visit notes, Call Notes, incidents and changes to the record, newest first, filtered by ?tl=.
  const tl = ["notes", "calls", "incidents", "changes"].includes(sp.tl ?? "") ? sp.tl! : "all";
  const stamp = (d: Date) => `${fmtLondonDate(londonDate(d), { day: "2-digit", month: "2-digit", year: "numeric" })} ${londonTime(d)}`;
  const entries: (TimelineEntry & { at: string; date: Date; kind: string })[] = [
    ...(glance?.notes ?? []).map((n) => ({ kind: "notes", id: `n-${n.id}`, date: n.createdAt, icon: <CheckCircle size={18} aria-hidden="true" />, title: "Visit note", href: `/rota/visits/${n.visitId}`, when: fmtDate(n.createdAt, true), text: n.text, at: stamp(n.createdAt) })),
    ...(callNotes?.notes.slice(0, 5) ?? []).map((c) => ({ kind: "calls", id: `c-${c.id}`, date: c.communicationAt, icon: <Phone size={18} aria-hidden="true" />, title: `Call note ${c.reference}`, href: tabHref("call-notes"), when: fmtDate(c.communicationAt, true), text: c.summary ?? undefined, by: c.recordedBy, at: stamp(c.communicationAt) })),
    ...(incidents ?? []).map((i) => ({ kind: "incidents", id: `i-${i.id}`, date: i.occurredAt, icon: <Warning size={18} aria-hidden="true" />, title: `Incident ${i.reference} ${i.status.toLowerCase().replaceAll("_", " ")}`, href: `/rota/incidents/${i.id}`, when: fmtDate(i.occurredAt, true), text: `${i.category}${i.safeguarding ? " · safeguarding" : ""}`, at: stamp(i.occurredAt) })),
    ...history.map((h) => ({ kind: "changes", id: `h-${h.id}`, date: h.createdAt, icon: <ClockCounterClockwise size={18} aria-hidden="true" />, title: humanAction(h.action), href: tabHref("history"), when: fmtDate(h.createdAt, true), by: names.get(h.actorId ?? "") ?? "System", at: stamp(h.createdAt) })),
  ].filter((e) => tl === "all" || e.kind === tl).sort((a, b) => b.date.getTime() - a.date.getTime());
  const months = [...new Map(entries.map((e) => [fmtLondonDate(londonDate(e.date), { month: "short", year: "numeric" }).toUpperCase(), [] as TimelineEntry[]])).entries()];
  for (const e of entries) months.find(([m]) => m === fmtLondonDate(londonDate(e.date), { month: "short", year: "numeric" }).toUpperCase())![1].push(e);
  const tlHref = (k: string) => `${base}?tab=overview${k === "all" ? "" : `&tl=${k}`}`;

  const tabs = groups.map((g) => {
    const key = g.tabs[0]!;
    const count = key === "people" ? su.contacts.length : undefined;
    return { key, label: g.label, href: tabHref(key), current: g === group, count };
  });
  const menu = [
    ...(canEdit && hasOrgPermission(ctx, "serviceUser.documents") && su.status !== "ENDED" && !su.archivedAt ? [{ label: "Upload documents", href: `/rota/coordinator?mode=EXISTING&person=${su.id}#start`, icon: <UploadSimple size={16} aria-hidden="true" /> }] : []),
    ...(canEdit ? [{ label: "Change status", href: `${base}?tab=overview#status`, icon: <ArrowsClockwise size={16} aria-hidden="true" /> }] : []),
    ...(canEdit ? [{ label: "Edit personal details", href: tabHref("details"), icon: <PencilSimple size={16} aria-hidden="true" /> }] : []),
    ...(canArchive ? [{ label: su.archivedAt ? "Restore or delete" : "Archive or delete", href: `${base}/archive`, testId: "open-archive", icon: <Archive size={16} aria-hidden="true" /> }] : []),
    { label: "Record history", href: tabHref("history"), icon: <ClockCounterClockwise size={16} aria-hidden="true" /> },
  ];
  const alerts: RecordAlert[] = [
    ...(su.riskLevel === "HIGH" ? [{ label: "High risk", tone: "bad" as const, icon: <Warning size={14} weight="bold" />, href: tabHref("risks") }] : su.riskLevel === "MEDIUM" ? [{ label: "Medium risk", tone: "warn" as const, icon: <Warning size={14} weight="bold" />, href: tabHref("risks") }] : []),
    ...(su.hasKeySafe ? [{ label: "Key safe recorded", tone: "info" as const, icon: <Key size={14} weight="bold" />, href: `${base}?tab=overview#before-visit` }] : []),
    ...(su.carerGenderPreference !== "ANY" ? [{ label: `Prefers ${su.carerGenderPreference.toLowerCase()} carers`, tone: "prog" as const, icon: <Heart size={14} weight="bold" />, href: `${base}?tab=overview#before-visit` }] : []),
    ...(su.status === "ACTIVE" ? [{ label: "Receiving care", tone: "ok" as const, icon: <Check size={14} weight="bold" /> }] : []),
  ];

  return (
    <div className="hb-rec" data-hb-module="rota">
      <RecordContextBar
        backHref="/rota/service-users"
        backLabel="Back to service users"
        kind="Service user"
        name={suName(su)}
        tools={[
          ...(canEdit ? [{ label: "Edit personal details", href: tabHref("details"), icon: <PencilSimple size={16} aria-hidden="true" /> }] : []),
          ...(canCallNotes ? [{ label: "Call notes", href: tabHref("call-notes"), icon: <ChatText size={16} aria-hidden="true" /> }] : []),
          ...(canReportIncident ? [{ label: "Report an incident", href: `/rota/incidents/new?su=${su.id}`, icon: <Warning size={16} aria-hidden="true" /> }] : []),
          ...(canNotes ? [{ label: "Visits", href: tabHref("visits"), icon: <CalendarBlank size={16} aria-hidden="true" /> }] : []),
        ]}
        actions={<>
          {canCallNotes ? <Link href={tabHref("call-notes")} className="hb-btn">Call notes</Link> : null}
          {canEdit && hasOrgPermission(ctx, "rota.edit") ? <Link href={`/rota/visits/new?serviceUserId=${su.id}`} className="hb-btn hb-btn-p"><Plus size={14} weight="bold" aria-hidden="true" />Add visit</Link> : null}
        </>}
      />
      <RecordHeader
        initials={initials}
        title={<><span className="uppercase">{su.lastName}</span>, {su.firstName} (Ref: {ref})</>}
        status={<>{su.archivedAt ? <StatusPill tone="neutral">Archived</StatusPill> : null}<StatusPill tone={statusTone}>{statusLabel}</StatusPill></>}
        meta={<>
          <div>Known as: <b>{su.preferredName ?? su.firstName}</b></div>
          <div>{su.branch?.name ? <>Branch: <b>{su.branch.name}</b> · </> : null}{su.area?.name ?? "No area"} · {su.postcode ?? "no postcode"}{su.organisation.isDemo ? ". Fictional demonstration person." : ""}</div>
        </>}
        ids={<>
          <span>Born: <b>{dob}</b></span>
          <span>First language: <b>{su.firstLanguage ?? "—"}</b></span>
          <span>NHS No: <b>{nhs}</b></span>
        </>}
        alerts={alerts}
      />
      <RecordTabs label="Service user sections" tabs={tabs} menu={menu} subTabs={group.tabs.map((t) => ({ key: t, label: tabLabel.get(t) ?? t, href: tabHref(t), current: t === tab }))} subLabel={`${group.label} sections`} />
      <div className="hb-rec-b">
      <Flash searchParams={sp} />
      {su.archivedAt ? (
        <p role="status" className="rounded-[4px] border border-slate-300 bg-slate-50 px-4 py-2.5 text-[14px] text-slate-800" data-testid="archived-banner">
          {suName(su)} was archived on {fmtDate(su.archivedAt)}. The record is read-only and hidden from the active lists; every record is kept.{canArchive ? <> <Link href={`${base}/archive`}>Restore</Link></> : null}
        </p>
      ) : null}

      {tab === "overview" ? (
        <div className="hb-cl">
          <div className="hb-cl-l">
            <QuickLinks items={[
              { label: "Before you visit", href: "#before-visit", icon: <Warning size={12} weight="bold" />, colour: "#b3261e" },
              { label: "Care plan", href: tabHref("care-plans"), icon: <ClipboardText size={12} weight="bold" />, colour: "#0f766e", count: plans.length },
              { label: "Risk assessments", href: tabHref("risks"), icon: <ShieldWarning size={12} weight="bold" />, colour: "#8c5200", count: risks.length },
              { label: "Medication", href: tabHref("medication"), icon: <Pill size={12} weight="bold" />, colour: "#5b3cc4" },
              { label: "Visits", href: tabHref("visits"), icon: <CalendarBlank size={12} weight="bold" />, colour: "#1f3a68", count: upcoming.length },
              ...(canNotes ? [{ label: "Visit notes", href: tabHref("notes"), icon: <CheckCircle size={12} weight="bold" />, colour: "#16784a" }] : []),
              ...(canCallNotes ? [{ label: "Call notes", href: tabHref("call-notes"), icon: <Phone size={12} weight="bold" />, colour: "#2e5bcf", count: callNotes?.total }] : []),
              ...(canReportIncident ? [{ label: "Incidents", href: tabHref("incidents"), icon: <Warning size={12} weight="bold" />, colour: "#b3261e", count: incidents?.length }] : []),
              { label: "Body map", href: tabHref("bodymap"), icon: <PersonSimple size={12} weight="bold" />, colour: "#b8336a" },
              { label: "Documents", href: tabHref("documents"), icon: <FileText size={12} weight="bold" />, colour: "#0e7490" },
              { label: "Contacts & carers", href: tabHref("people"), icon: <UsersThree size={12} weight="bold" />, colour: "#b8336a", count: su.contacts.length },
              { label: "References", href: tabHref("references"), icon: <IdentificationCard size={12} weight="bold" />, colour: "#b4532a" },
              ...(canAiAudit ? [{ label: "Audit & exceptions", href: tabHref("ai-audit"), icon: <MagnifyingGlass size={12} weight="bold" />, colour: "#8c5200" }] : []),
              { label: "History", href: tabHref("history"), icon: <ClockCounterClockwise size={12} weight="bold" />, colour: "#1f3a68" },
            ]} />
            <HbPanel id="person-details" title="Person details" icon={<User size={15} weight="bold" />} colour="blue" className="hb-cl-first" fullHref={tabHref("details")}
              footer={canEdit ? <Link href={tabHref("details")} className="hb-btn hb-btn-p">Edit</Link> : undefined}>
              <KeyValueList items={[
                ["Full name", fullName],
                ["Known as", su.preferredName ?? su.firstName],
                ["Address", address],
                ["Phone", su.phone ?? "—"],
                ["Date of birth", dob],
                ["NHS number", nhs],
                ["First language", su.firstLanguage ?? "—"],
                ["Carer preference", su.carerGenderPreference === "ANY" ? "No preference" : `${su.carerGenderPreference.toLowerCase()} carers`],
                ["Risk", su.riskLevel ? su.riskLevel.toLowerCase() : "Not assessed"],
                ["Status", `${statusLabel}${su.startDate ? ` since ${fmtDate(su.startDate)}` : ""}`],
              ]} />
              {su.carePreferences ? <p className="mt-2 text-[13px] text-[var(--hb-ink-2)]"><b className="font-semibold text-[var(--hb-ink)]">What matters to them:</b> {su.carePreferences}</p> : null}
            </HbPanel>
            <HbPanel id="key-contacts" title="Key contacts" icon={<UsersThree size={15} weight="bold" />} colour="rose" count={su.contacts.length} fullHref={tabHref("people")} flush
              tools={canEdit ? [{ label: "Add a contact", href: `${tabHref("people")}#add-contact`, icon: <Plus size={16} /> }] : undefined}>
              {su.contacts.length ? (
                <DataTable caption="Key contacts" rowKey={(c) => c.id} rows={su.contacts.slice(0, 5)} columns={[
                  { key: "name", header: "Name", cell: (c) => <>{c.name}{c.isEmergency ? <span className="mt-0.5 block"><span className="hb-tag">Emergency</span></span> : c.kind === "NEXT_OF_KIN" ? <span className="mt-0.5 block"><span className="hb-tag">Next of kin</span></span> : null}</> },
                  { key: "rel", header: "Relationship", cell: (c) => c.relationship ?? CONTACT_LABEL[c.kind] },
                  { key: "phone", header: "Phone", cell: (c) => <span className="tabular-nums">{c.phone ?? "—"}</span> },
                ]} />
              ) : <p className="px-3.5 py-4 text-[13.5px] text-[var(--hb-ink-3)]">No contacts recorded.</p>}
            </HbPanel>
            <HbPanel id="risks-safety" title="Risks and safety" icon={<Warning size={15} weight="bold" />} colour="red" count={risks.length} fullHref={tabHref("risks")} flush
              tools={hasOrgPermission(ctx, "care.plan.edit") ? [{ label: "New risk assessment", href: `/rota/risks/new?su=${su.id}`, icon: <Plus size={16} /> }] : undefined}>
              {risks.length ? (
                <DataTable caption="Risk assessments" rowKey={(r) => r.id} rows={risks.slice(0, 5)} columns={[
                  { key: "risk", header: "Risk", cell: (r) => <Link href={`/rota/risks/${r.id}`}>{r.title}</Link> },
                  { key: "level", header: "Level", cell: (r) => <StatusPill tone={r.level === "HIGH" ? "bad" : r.level === "MEDIUM" ? "warn" : "ok"}>{LEVEL[r.level].label}</StatusPill> },
                  { key: "review", header: "Review", cell: (r) => <span className="tabular-nums">{fmtLondonDate(fromDbDate(r.reviewDue), { day: "numeric", month: "short" })}</span> },
                ]} />
              ) : <p className="px-3.5 py-4 text-[13.5px] text-[var(--hb-ink-3)]">No active risk assessments.</p>}
            </HbPanel>
            <HbPanel id="before-visit" title="Before you visit" icon={<Warning size={15} weight="bold" />} colour="amber" flush action={<PanelAction href={tabHref("incidents")}>Health and safety</PanelAction>}>
              <ul className="hb-bv">
                <li><span className="hb-bv-i" aria-hidden="true"><House size={15} /></span><span className="min-w-0"><b>Getting in</b><small>{su.accessNotes ?? "No access notes."}</small></span></li>
                <li>
                  <span className="hb-bv-i" aria-hidden="true"><Key size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <b>Key safe</b>
                    {su.hasKeySafe ? (
                      canKeySafe ? (
                        keySafe ? <small>Key safe code: <span className="font-mono text-[15px] font-semibold text-[var(--hb-ink)]">{keySafe}</span> This view has been recorded.</small>
                        : <small>Each view of the code is recorded.</small>
                      ) : <small>A key safe code is recorded. Your role cannot view it.</small>
                    ) : <small>No key safe code recorded.</small>}
                    {keySafeError ? <small role="alert" className="text-[#a3242c]">{keySafeError}</small> : null}
                    {canKeySafe && canEdit ? (
                      <form action={keySafeAction} className="mt-2 flex gap-2">
                        <input type="hidden" name="back" value={back} />
                        <input type="hidden" name="serviceUserId" value={su.id} />
                        <input name="code" autoComplete="off" className="input py-1" placeholder="New code (blank clears)" aria-label="New key safe code" />
                        <button className="hb-btn">Save</button>
                      </form>
                    ) : null}
                  </span>
                  {su.hasKeySafe && canKeySafe && !keySafe ? <form method="get" className="flex-none"><input type="hidden" name="reveal" value="keysafe" /><button className="hb-btn" aria-label="Show key safe code">Show code</button></form> : null}
                </li>
                {su.communicationNeeds ? <li><span className="hb-bv-i" aria-hidden="true"><ChatText size={15} /></span><span className="min-w-0"><b>Communication</b><small>{su.communicationNeeds}</small></span></li> : null}
                {su.riskSummary ? <li><span className="hb-bv-i" aria-hidden="true"><Warning size={15} /></span><span className="min-w-0"><b>Risk summary</b><small>{su.riskSummary}</small></span></li> : null}
                {su.carerGenderPreference !== "ANY" ? <li><span className="hb-bv-i" aria-hidden="true"><Heart size={15} /></span><span className="min-w-0"><b>Prefers {su.carerGenderPreference.toLowerCase()} carers</b><small>Carer preference</small></span></li> : null}
              </ul>
            </HbPanel>
            <HbPanel id="care-plan" title="Care plan" icon={<ClipboardText size={15} weight="bold" />} colour="teal" fullHref={tabHref("care-plans")} action={activePlan ? <PanelAction href={`/rota/care-plans/${su.id}`}>Open</PanelAction> : undefined}>
              {activePlan ? (
                <KeyValueList items={[
                  ["Version", `${activePlan.version}, ${activePlan.status === "ACTIVE" ? "in use" : activePlan.status === "IN_REVIEW" ? "in review" : activePlan.status.toLowerCase().replaceAll("_", " ")}`],
                  ["Review due", activePlan.reviewDue ? <span className={activePlan.reviewDue < todayDb && activePlan.status === "ACTIVE" ? "text-[#a3242c]" : ""}>{fmtLondonDate(fromDbDate(activePlan.reviewDue))}</span> : "—"],
                  ["Approved", activePlan.approvedAt ? fmtDate(activePlan.approvedAt) : "—"],
                ]} />
              ) : <p className="text-[13.5px] text-[var(--hb-ink-3)]">No care plan recorded for this person.</p>}
              {glance ? (
                <div className="mt-2 space-y-1 text-[13px]" data-testid="recent-care">
                  <p><span className="text-[var(--hb-ink-3)]">Medication:</span> {glance.medication.on ? <><Link href={tabHref("medication")}>{glance.medication.active} {glance.medication.active === 1 ? "medicine" : "medicines"} in use</Link><span className={glance.medication.exceptions7d ? " text-[#a3242c]" : " text-[var(--hb-ink-3)]"}> · {glance.medication.exceptions7d} refused or not given in 7 days</span></> : <span className="text-[var(--hb-ink-3)]">Medication records are switched off</span>}</p>
                  <p><span className="text-[var(--hb-ink-3)]">Care Summary:</span> {glance.summary ? <Link href={`/rota/care-plans/${su.id}?view=summary&summary=${glance.summary.id}`}>{fmtDate(glance.summary.createdAt)}, {glance.summary.status === "UNREVIEWED" ? "not yet reviewed" : glance.summary.status === "REVIEWED" ? "reviewed" : "dismissed"}</Link> : <Link href={`/rota/care-plans/${su.id}?view=summary`}>Recent records</Link>}</p>
                </div>
              ) : null}
            </HbPanel>
            {discharge?.length ? <div className="hb-cl-wide"><DischargeReviews reviews={discharge} back={`${base}?tab=overview`} serviceUserId={su.id} /></div> : null}
            <ServiceUserCompliance rows={compliance} className="hb-cl-wide" />
          </div>
          <Timeline
            filters={[["all", "All"], ["notes", "Visit notes"], ...(canCallNotes ? [["calls", "Call notes"]] : []), ...(canReportIncident ? [["incidents", "Incidents"]] : []), ["changes", "Record changes"]].map(([k, l]) => ({ label: l!, href: tlHref(k!), current: tl === k }))}
            groups={months.map(([label, list]) => ({ label, entries: list }))}
            empty="Nothing recorded yet."
          />
          <HbPanel id="completed-visits" title="Completed visits with staff" icon={<CheckCircle size={15} weight="bold" />} colour="green" count={completed.length} className="hb-cl-half" flush fullHref={tabHref("visits")}>
            {completed.length ? (
              <DataTable caption="Completed visits" rowKey={(v) => v.id} rows={completed.slice(0, 5)} columns={[
                { key: "date", header: "Date", cell: (v) => <Link href={`/rota/visits/${v.id}`}>{fmtLondonDate(fromDbDate(v.date), { weekday: "short", day: "numeric", month: "short" })}</Link> },
                { key: "call", header: "Call", cell: (v) => v.callType.name },
                { key: "staff", header: "Staff", cell: (v) => v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.staff.displayName).join(", ") || "—" },
                { key: "times", header: "Times", cell: (v) => <span className="tabular-nums">{v.actualStart ? `${londonTime(v.actualStart)} to ${v.actualEnd ? londonTime(v.actualEnd) : "…"}` : `${londonTime(v.scheduledStart)} to ${londonTime(v.scheduledEnd)}`}</span> },
              ]} />
            ) : <p className="px-3.5 py-4 text-[13.5px] text-[var(--hb-ink-3)]">No completed visits in the last seven days.</p>}
          </HbPanel>
          <HbPanel id="next-visits" title="Visits for the next 14 days" icon={<CalendarBlank size={15} weight="bold" />} colour="blue" count={upcoming.length} className="hb-cl-half" flush fullHref={tabHref("visits")} action={canNotes ? <PanelAction href={`/rota/visits?date=${today}`}>Daily Rota</PanelAction> : undefined}>
            {upcomingDays.length ? (
              <DataTable caption="Visits for the next 14 days" rowKey={(d) => d} rows={upcomingDays.slice(0, 7)} columns={[
                { key: "day", header: "Day", cell: (d) => fmtLondonDate(d, { weekday: "short", day: "numeric", month: "short" }) },
                { key: "calls", header: "Calls", cell: (d) => upcoming.filter((v) => dayOf(v) === d).map((v) => <Link key={v.id} href={`/rota/visits/${v.id}`} className="mr-1.5">{v.callType.name.toLowerCase()} {londonTime(v.scheduledStart)}</Link>) },
                { key: "carers", header: "Carers", cell: (d) => { const day = upcoming.filter((v) => dayOf(v) === d); const need = day.reduce((n, v) => n + v.carersRequired, 0); const have = day.reduce((n, v) => n + Math.min(placesFilled(v), v.carersRequired), 0); return have >= need ? <StatusPill tone="ok">All booked</StatusPill> : <StatusPill tone="bad">{have} of {need} carers</StatusPill>; } },
              ]} />
            ) : <p className="px-3.5 py-4 text-[13.5px] text-[var(--hb-ink-3)]">No visits in the next 14 days.</p>}
          </HbPanel>
          <HbPanel id="week-visits" title="This week's visits" icon={<CalendarBlank size={15} weight="bold" />} colour="navy" className="hb-cl-half" fullHref={tabHref("rota")} action={canEdit ? <PanelAction href={`/rota/templates/new?su=${su.id}`}>New template</PanelAction> : undefined}>
            {weekCalls.length ? (
              <div className="overflow-x-auto">
                <table className="hb-wk">
                  <caption className="sr-only">Visits this week by call and day</caption>
                  <thead><tr><td />{weekDays.map((d) => <th key={d} scope="col" data-today={d === today ? "" : undefined}>{fmtLondonDate(d, { weekday: "short", day: "numeric" })}</th>)}</tr></thead>
                  <tbody>
                    {weekCalls.map((call) => (
                      <tr key={call}>
                        <th scope="row">{call}</th>
                        {weekDays.map((d) => {
                          const vs = weekVisits.filter((v) => v.callType.name === call && dayOf(v) === d);
                          return <td key={d}>{vs.map((v) => { const open = Math.max(0, v.carersRequired - placesFilled(v)); return <Link key={v.id} href={`/rota/visits/${v.id}`} className="hb-wk-c" data-s={open ? "open" : v.status === "COMPLETED" ? "done" : undefined} aria-label={`${call} ${fmtLondonDate(d, { weekday: "long" })}: ${v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.staff.displayName).join(", ") || "no carer"}${open ? `, ${open} place open` : ""}`}>{v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => ini(a.staff.displayName)).join(" ") || "—"}{open ? ` +${open}` : ""}</Link>; })}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--hb-ink-3)]"><span><span className="hb-wk-c" data-s="done" aria-hidden="true">AB</span> Completed</span><span><span className="hb-wk-c" aria-hidden="true">AB</span> Booked</span><span><span className="hb-wk-c" data-s="open" aria-hidden="true">+1</span> A carer place is open</span></p>
              </div>
            ) : <p className="text-[13.5px] text-[var(--hb-ink-3)]">No visits this week.</p>}
            {su.templates.length ? (
              <details className="mt-3 border-t border-[var(--hb-line-2)] pt-2">
                <summary className="cursor-pointer text-[13px] font-semibold text-[var(--hb-link)]">Repeating visits ({su.templates.length})</summary>
                <table className="table mt-2">
                  <thead><tr><th>Call</th><th>Time</th><th>Days</th><th>Carers</th></tr></thead>
                  <tbody>
                    {su.templates.map((t) => (
                      <tr key={t.id}>
                        <td><Link href={`/rota/templates/${t.id}`}>{t.callType.name}</Link></td>
                        <td className="tabular-nums">{hhmm(t.startMinute)} · {t.durationMin}m</td>
                        <td>{t.weekdays.length === 7 ? "Every day" : t.weekdays.map((d) => WEEKDAYS[d - 1]!.slice(0, 2)).join(" ")} · weeks {t.cycleWeeks.join(", ")}</td>
                        <td>{preferredOf(t).map((x) => (x ? staffName.get(x) ?? "Former staff" : "No carer")).join(" + ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : <p className="mt-2 text-[12.5px] text-[var(--hb-ink-3)]">No repeating visits.</p>}
          </HbPanel>
          <CarePackageSummaryCard className="hb-cl-q" summary={carePackageSummary({ pkg: active, coverage, templates: su.templates, openQueries: pkgReviews?.open ?? 0, today })} href={`${base}?tab=package`} canEdit={canEdit} />
          <HbPanel id="care-team" title="Care team" icon={<Heart size={15} weight="bold" />} colour="purple" className="hb-cl-q" flush fullHref={tabHref("people")} action={<PanelAction href={tabHref("people")}>Contacts & carers</PanelAction>}>
            {glance?.carers.length ? (
              <DataTable caption="Carers who visit most" rowKey={(c) => c.id} rows={glance.carers} columns={[
                { key: "carer", header: "Carer", cell: (c) => <span className="inline-flex items-center gap-2"><span className="hb-av" aria-hidden="true">{ini(c.name)}</span>{c.name}</span> },
                { key: "visits", header: "Visits, 28 days", cell: (c) => <span className="tabular-nums">{c.visits}</span> },
              ]} />
            ) : <p className="px-3.5 py-4 text-[13.5px] text-[var(--hb-ink-3)]">No visits booked in the last 28 days.</p>}
            <div className="border-t border-[var(--hb-line-2)] px-3.5 py-3">
              <p className="text-[12.5px] font-semibold text-[var(--hb-ink-2)]">Away</p>
              {su.absences.length ? (
                <ul className="mt-1 space-y-2 text-[13px]">
                  {su.absences.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span>{a.reason.toLowerCase()} · {fmtDate(a.startsAt)}{a.endsAt ? ` to ${fmtDate(new Date(a.endsAt.getTime() - 1))}` : " onwards"}</span>
                      {canEdit ? <form action={cancelAbsenceAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="serviceUserId" value={su.id} /><input type="hidden" name="absenceId" value={a.id} /><button className="hb-btn">End now</button></form> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-[13px] text-[var(--hb-ink-3)]">Not away, nothing planned.</p>}
              {canEdit && su.status !== "ENDED" ? (
                <details className="mt-2">
                  <summary className="hb-btn cursor-pointer">Record an absence</summary>
                  <form action={addAbsenceAction} className="mt-3 grid grid-cols-2 gap-2">
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="serviceUserId" value={su.id} />
                    <label className="col-span-2"><span className="label">Reason</span><select name="reason" className="input"><option value="HOSPITAL">Hospital</option><option value="RESPITE">Respite</option><option value="HOLIDAY">Holiday</option><option value="OTHER">Other</option></select></label>
                    <label><span className="label">First day</span><input type="date" name="from" required defaultValue={today} className="input" /></label>
                    <label><span className="label">Last day</span><input type="date" name="to" className="input" /></label>
                    <label className="col-span-2"><span className="label">Note</span><input name="note" className="input" /></label>
                    <button className="btn-secondary col-span-2">Record absence</button>
                    <p className="col-span-2 text-[12.5px] text-slate-500">Built visits in the period that have not started are cancelled. No last day means until further notice.</p>
                  </form>
                </details>
              ) : null}
            </div>
          </HbPanel>
          {canEdit ? (
            <HbPanel id="status" title="Status" icon={<ArrowsClockwise size={15} weight="bold" />} colour="navy" className="hb-cl-half">
              <form action={serviceUserStatusAction} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="serviceUserId" value={su.id} />
                <label className="block"><span className="label">Move to</span><select name="to" className="input">{nextStatuses(su.status).map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></label>
                <label className="block"><span className="label">End date (when ending care)</span><input type="date" name="endDate" className="input" /></label>
                <label className="block sm:col-span-2"><span className="label">Reason</span><input name="reason" required minLength={3} className="input" /></label>
                <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button className="btn-secondary">Change status</button><p className="text-[12.5px] text-slate-500">Ending care switches off their repeating visits and cancels future visits that have not started.</p></div>
              </form>
            </HbPanel>
          ) : null}
        </div>
      ) : null}

      {tab === "care-plans" ? (
        <Card title="Care plans" actions={<Link href={`/rota/care-plans/${su.id}`} className="btn-primary">View or manage care plan</Link>}>
          <p className="mb-3 text-[13.5px] text-slate-600">Care plans for {suName(su)}. Review the current plan, its status and earlier versions here.</p>
          {plans.length ? (
            <div className="relative min-w-0 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Version</th><th>Status</th><th>Review due</th><th>Approved</th><th>Record</th></tr></thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id}>
                      <td className="font-medium">Version {plan.version}</td>
                      <td><Badge tone={plan.status === "ACTIVE" ? "green" : plan.status === "IN_REVIEW" ? "amber" : "slate"}>{plan.status === "ACTIVE" ? "In use" : plan.status === "IN_REVIEW" ? "In review" : plan.status === "DRAFT" ? "Draft" : plan.status.toLowerCase().replaceAll("_", " ")}</Badge></td>
                      <td>{plan.reviewDue ? <span className={plan.reviewDue < todayDb && plan.status === "ACTIVE" ? "font-medium text-[#a3242c]" : ""}>{fmtLondonDate(fromDbDate(plan.reviewDue))}</span> : "—"}</td>
                      <td>{plan.approvedAt ? fmtDate(plan.approvedAt) : "—"}</td>
                      <td><Link href={`/rota/care-plans/${su.id}?v=${plan.version}`}>Open plan</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No care plan recorded for this person.</Empty>}
        </Card>
      ) : null}

      {tab === "risks" ? (
        <Card title="Risk assessments" actions={hasOrgPermission(ctx, "care.plan.edit") ? <Link href={`/rota/risks/new?su=${su.id}`} className="btn-primary">New assessment</Link> : null}>
          <p className="mb-3 text-[13.5px] text-slate-600">Active risk assessments for {suName(su)}, soonest review first. Open one to read its hazards, controls, actions still required and every saved version.</p>
          {risks.length ? (
            <div className="relative min-w-0 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Assessment</th><th>Category</th><th>Level</th><th>Review</th><th>Actions required</th><th>Version</th></tr></thead>
                <tbody>
                  {risks.map((risk) => {
                    const state = reviewState(risk.reviewDue, today);
                    return (
                      <tr key={risk.id}>
                        <td><Link href={`/rota/risks/${risk.id}`}>{risk.title}</Link></td>
                        <td>{RISK_TYPE_LABEL[risk.type]}</td>
                        <td><Badge tone={LEVEL[risk.level].tone}>{LEVEL[risk.level].label}</Badge></td>
                        <td><span className="tabular-nums">{fmtLondonDate(fromDbDate(risk.reviewDue))}</span> <Badge tone={REVIEW_TONE[state]}>{REVIEW_STATE_LABEL[state]}</Badge></td>
                        <td className="max-w-[260px]">{risk.requiredActions ? <span className="line-clamp-2" title={risk.requiredActions}>{risk.responsiblePerson}: {risk.requiredActions}</span> : <span className="text-slate-500">None</span>}</td>
                        <td className="tabular-nums">{risk.version}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty>No active risk assessments for this person.</Empty>}
          {archivedRisks.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">Archived assessments ({archivedRisks.length})</summary>
              <ul className="rows mt-1 text-[14px]">
                {archivedRisks.map((r) => <li key={r.id} className="py-1.5"><Link href={`/rota/risks/${r.id}`}>{r.title}</Link> <span className="text-[13px] text-slate-600">{RISK_TYPE_LABEL[r.type]}{r.archivedAt ? ` · archived ${fmtDate(r.archivedAt)}` : ""}</span></li>)}
              </ul>
            </details>
          ) : <p className="mt-3 text-[13px] text-slate-600">No archived assessments.</p>}
        </Card>
      ) : null}

      {tab === "notes" && notes ? (
        <Card title="Visit notes">
          <form method="get" className="mb-3 flex flex-wrap items-end gap-2" aria-label="Filter visit notes">
            <input type="hidden" name="tab" value="notes" />
            <label><span className="label">Period</span><select name="days" defaultValue={String(notes.days)} className="input"><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option></select></label>
            <label><span className="label">Kind</span><select name="category" defaultValue={sp.category ?? ""} className="input"><option value="">Any</option>{Object.entries(NOTE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label><span className="label">Contains</span><input name="q" defaultValue={sp.q ?? ""} className="input" /></label>
            <button className="btn-primary">Apply</button>
            <Link href={`${base}?tab=notes`} className="btn-secondary">Clear</Link>
          </form>
          {notes.notes.length ? (
            <ul className="rows">
              {notes.notes.map((n) => (
                <li key={n.id} className="py-3 text-[14.5px]">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-600">
                    <Badge tone={n.category === "CONCERN" ? "rose" : n.category === "HANDOVER" ? "violet" : "slate"}>{NOTE_LABEL[n.category] ?? n.category}</Badge>
                    <Link href={`/rota/visits/${n.visit.id}`} className="row-title">{fmtLondonDate(londonDate(n.visit.scheduledStart), { weekday: "short", day: "numeric", month: "short" })} · {n.visit.callType}</Link>
                    <span className="tabular-nums">planned {londonTime(n.visit.scheduledStart)}–{londonTime(n.visit.scheduledEnd)}</span>
                    <span>{n.actualMinutes !== null ? `actual ${n.actualMinutes} min` : "no clock times"}</span>
                    <span className="ml-auto">{n.author}{n.fromOffice ? " (office)" : ""} · {fmtDate(n.createdAt, true)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line">{n.text}</p>
                </li>
              ))}
            </ul>
          ) : <Empty>No visit notes for this person in this period.</Empty>}
          {notes.notes.length === 300 ? <p className="mt-2 text-[13px] text-slate-600">Showing the newest 300. Narrow the period or kind to see older notes.</p> : null}
          <p className="mt-2 text-[12.5px] text-slate-500">Notes are written on visits by carers and the office and cannot be edited or deleted.</p>
        </Card>
      ) : null}

      {tab === "incidents" && canReportIncident ? (
        <Card title="Incidents" actions={<Link href={`/rota/incidents/new?su=${su.id}`} className="btn-primary">Report an incident</Link>}>
          <p className="mb-3 text-[13.5px] text-slate-600">Incidents linked to {suName(su)}, including open and closed reports. Records are shown according to your incident permissions.</p>
          {incidents?.length ? (
            <div className="relative min-w-0 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Reference</th><th>When</th><th>Category</th><th>Severity</th><th>Status</th></tr></thead>
                <tbody>
                  {incidents.map((incident) => (
                    <tr key={incident.id}>
                      <td><Link href={`/rota/incidents/${incident.id}`}>{incident.reference}</Link></td>
                      <td>{fmtDate(incident.occurredAt, true)}</td>
                      <td>{incident.category}{incident.safeguarding ? <> <Badge tone="rose">Safeguarding</Badge></> : null}</td>
                      <td><SeverityBadge severity={incident.severity} /></td>
                      <td><IncidentStatusBadge status={incident.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No incidents recorded for this person that you have permission to view.</Empty>}
          {incidents && incidents.length === 100 ? <p className="mt-2 text-[12.5px] text-slate-600">Showing the latest 100 incidents.</p> : null}
        </Card>
      ) : null}

      {tab === "medication" ? (
        !hasOrgPermission(ctx, "medication.view") ? <Card><Empty>You do not have access to medication records.</Empty></Card>
        : !(await medicationEnabled(su.organisationId)) ? <MedicationOff />
        : await (async () => {
          const meds = await listMedications(ctx, su.id);
          const medNames = await memberNames(ctx, meds.flatMap((m) => [m.createdById, m.approvedById]));
          return <MedicationList meds={meds} serviceUserId={su.id} back={back} canManage={hasOrgPermission(ctx, "medication.manage")} me={ctx.userId} names={medNames} month={today.slice(0, 7)} />;
        })()
      ) : null}

      {tab === "package" && coverage && pkgReviews && pkgSources ? (
        <CarePackageTab
          person={{ id: su.id, name: suName(su), reference: su.reference }}
          packages={su.packages}
          templates={su.templates}
          coverage={coverage}
          reviews={pkgReviews}
          sources={pkgSources}
          history={pkgHistory}
          names={names}
          funders={funders}
          can={{ edit: canEdit, fund: canFund, rota: canNotes, resolve: canEdit && hasOrgPermission(ctx, "rota.edit") && hasOrgPermission(ctx, "serviceUser.documents"), intake: canEdit && hasOrgPermission(ctx, "rota.edit") && hasOrgPermission(ctx, "serviceUser.documents") }}
          base={base}
          back={back}
          today={today}
        />
      ) : null}

      {tab === "visits" ? (
        <Card title={`Visits from ${fmtLondonDate(addDays(today, -14), { day: "numeric", month: "short" })} to ${fmtLondonDate(addDays(today, 14), { day: "numeric", month: "short" })}`}>
          {visits.length ? (
            <table className="table">
              <thead><tr><th>Date</th><th>Time</th><th>Call</th><th>Carers</th><th>Status</th></tr></thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id} className={v.status === "CANCELLED" ? "opacity-60" : undefined}>
                    <td><Link href={`/rota/visits/${v.id}`}>{fmtLondonDate(fromDbDate(v.date), { weekday: "short", day: "numeric", month: "short" })}</Link></td>
                    <td className="tabular-nums">{londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)}{v.actualStart ? <span className="block text-[12px] text-slate-500">actual {londonTime(v.actualStart)}–{v.actualEnd ? londonTime(v.actualEnd) : "…"}</span> : null}</td>
                    <td>{v.callType.name}</td>
                    <td><CarerSlots assignments={v.assignments} carersRequired={v.carersRequired} cancelled={v.status === "CANCELLED"} /></td>
                    <td><VisitStatusBadge status={v.status} />{v.cancelReason ? <span className="block text-[12px] text-slate-500">{v.cancelReason}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No visits in this period.</Empty>}
        </Card>
      ) : null}

      {tab === "people" ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card title="Contacts">
            {su.contacts.length ? (
              <ul className="rows">
                {su.contacts.map((c) => (
                  <li key={c.id} className="py-2.5 text-[14px]">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{c.name} {c.isPrimary ? <Badge tone="violet">Primary contact</Badge> : null} {c.isEmergency ? <Badge tone="rose">Emergency</Badge> : null} {c.canReceiveUpdates ? <Badge tone="teal">Can receive updates</Badge> : null}</div>
                        <div className="text-slate-600">{CONTACT_LABEL[c.kind]}{c.relationship ? ` · ${c.relationship}` : ""}{c.phone ? ` · ${c.phone}` : ""}{c.altPhone ? ` · alt. ${c.altPhone}` : ""}{c.email ? ` · ${c.email}` : ""}</div>
                        {c.authorityType ? <div className="text-[13px] text-slate-600">Authority: {AUTHORITY_LABEL[c.authorityType as keyof typeof AUTHORITY_LABEL] ?? c.authorityType}{c.authorityScope ? ` (${c.authorityScope})` : ""}</div> : null}
                        {c.preferredContactMethod ? <div className="text-[13px] text-slate-600">Prefers: {PREFERRED_LABEL[c.preferredContactMethod] ?? c.preferredContactMethod}</div> : null}
                      </div>
                      {canEdit ? <form action={removeContactAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="serviceUserId" value={su.id} /><input type="hidden" name="contactId" value={c.id} /><button className="btn-secondary py-0.5 text-[13px]">Remove</button></form> : null}
                    </div>
                    {canEdit ? (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[13px] font-medium text-[#1d4f91]">Edit {c.name}</summary>
                        <form action={updateContactAction} className="mt-2 grid gap-2 md:grid-cols-2">
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="serviceUserId" value={su.id} />
                          <input type="hidden" name="contactId" value={c.id} />
                          <ContactFields c={c} />
                          <button className="btn-secondary md:col-span-2">Save contact</button>
                        </form>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <Empty>No contacts recorded.</Empty>}
            {canEdit ? (
              <form id="add-contact" action={addContactAction} className="mt-3 grid gap-2 border-t border-slate-200 pt-3 md:grid-cols-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="serviceUserId" value={su.id} />
                <ContactFields />
                <button className="btn-secondary md:col-span-2">Add contact</button>
              </form>
            ) : null}
            <p className="mt-2 text-[12.5px] text-slate-500">Emergency contact, permission to receive updates and authority to act are recorded separately. Being next of kin does not give authority. Communication already recorded keeps the number used at the time.</p>
          </Card>
          <Card title="Carer preferences">
            {su.carerPreferences.length ? (
              <ul className="rows">
                {su.carerPreferences.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px]">
                    <div>
                      <Link href={`/rota/staff/${p.staff.id}`} className="row-title">{p.staff.displayName}</Link> {p.blocked ? <Badge tone="rose">Must not visit</Badge> : null} {p.rating ? <Badge tone={p.rating >= 4 ? "green" : p.rating <= 2 ? "amber" : "slate"}>Rating {p.rating} of 5</Badge> : null}
                      {p.reason ? <div className="text-slate-600">{p.reason}</div> : null}
                    </div>
                    {canEdit ? <form action={removeCarerPreferenceAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="serviceUserId" value={su.id} /><input type="hidden" name="staffId" value={p.staff.id} /><button className="btn-secondary py-0.5 text-[13px]">Remove</button></form> : null}
                  </li>
                ))}
              </ul>
            ) : <Empty>No carer preferences recorded.</Empty>}
            {canEdit ? (
              <form action={carerPreferenceAction} className="mt-3 grid gap-2 border-t border-slate-200 pt-3 md:grid-cols-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="serviceUserId" value={su.id} />
                <label className="md:col-span-2"><span className="label">Carer</span><select name="staffId" required className="input"><option value="">Choose…</option>{lk.carers.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
                <label><span className="label">Rating</span><select name="rating" className="input"><option value="">No rating</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                <label className="flex items-center gap-2 pt-6 text-[14px]"><input type="checkbox" name="blocked" className="h-4 w-4" /> Must not visit</label>
                <label className="md:col-span-2"><span className="label">Reason</span><input name="reason" className="input" placeholder="Required when a carer must not visit" /></label>
                <button className="btn-secondary md:col-span-2">Save preference</button>
                <p className="text-[12.5px] text-slate-500 md:col-span-2">A carer who must not visit is never offered for this person, and visits already booked with them are flagged for review.</p>
              </form>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "details" ? (
        <Card>
          {canEdit ? (
            <ServiceUserForm action={updateServiceUserAction} su={su} areas={lk.areas} back={back} sensitive={hasOrgPermission(ctx, "serviceUser.sensitive")} submit="Save details" />
          ) : (
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="Address">{[su.addressLine1, su.addressLine2, su.town, su.postcode].filter(Boolean).join(", ") || "—"}</Field>
              <Field label="Phone">{su.phone ?? "—"}</Field>
              <Field label="NHS number">{su.sensitiveHidden ? "Restricted" : su.nhsNumber ?? "—"}</Field>
            </dl>
          )}
        </Card>
      ) : null}

      {tab === "references" ? <ServiceUserReferenceNumbers ctx={ctx} serviceUserId={su.id} base={base} /> : null}

      {tab === "template" && suTemplates ? <ServiceUserTemplateTab base={base} rows={suTemplates} weeks={tplWeeks} days={tplDays} cycleLength={cycleLength} canEdit={hasOrgPermission(ctx, "rota.edit")} canBuild={canBuild} serviceUserId={su.id} confirmOff={sp.off} /> : null}
      {future ? <ServiceUserFutureRota base={base} from={future.from} weeks={future.weeks} thisMonday={mondayOf(today)} preview={futurePreview} error={futureError} /> : null}
      {tab === "rota" && suRota ? <ServiceUserRotaTab base={base} rota={suRota} filter={parseSuRotaFilter(sp.status)} thisMonday={mondayOf(today)} canEdit={hasOrgPermission(ctx, "rota.edit")} canBuild={canBuild} serviceUserId={su.id} /> : null}
      {tab === "missed" ? <MissedHistory ctx={ctx} serviceUserId={su.id} /> : null}

      {tab === "documents" ? (
        <>
          <nav aria-label="Document sections" className="flex flex-wrap gap-1.5 border-b border-slate-200 bg-white px-3 py-2">
            {([["council", "Council Documents"], ["other", "Other Documents"], ["forms", "Forms"]] as const).map(([k, label]) => {
              const on = (sp.section === "other" || sp.section === "forms" ? sp.section : "council") === k;
              return <Link key={k} href={`${base}?tab=documents&section=${k}`} aria-current={on ? "page" : undefined} className={`rounded-full px-3 py-1 text-[13.5px] no-underline ${on ? "bg-[#1d4f91] font-medium text-white hover:text-white" : "bg-[#eef1f5] text-[#1d2939] hover:bg-[#e1e6ee]"}`}>{label}</Link>;
            })}
          </nav>
          {suForms ? (
            <PersonForms rows={suForms.rows} startable={suForms.startable} about={`SERVICE_USER:${su.id}`} back={`${base}?tab=documents&section=forms`} personName={suName(su)} testId="service-user-forms" />
          ) : <ServiceUserDocuments ctx={ctx} serviceUserId={su.id} section={sp.section === "other" ? "OTHER" : "COUNCIL"} selectedId={sp.doc} base={base} inForce={sp.inforce} compare={sp.compare} />}
        </>
      ) : null}

      {tab === "call-notes" ? <CallNotesSection ctx={ctx} serviceUserId={su.id} personName={suName(su)} base={base} sp={sp} /> : null}

      {tab === "bodymap" ? <BodyMapSection ctx={ctx} serviceUserId={su.id} personName={`${su.firstName} ${su.lastName}`} base={base} sp={sp} /> : null}

      {tab === "ai-audit" && canAiAudit ? <ServiceUserAiAudit ctx={ctx} serviceUserId={su.id} base={base} sp={sp} /> : null}

      {tab === "history" ? (
        <Card title="Record history">
          {history.length ? (
            <ol className="space-y-2 text-[14px]">
              {history.map((h) => (
                <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                  <div className="font-medium">{h.action.replace("serviceUser.", "").replace(/\./g, " ")}</div>
                  <div className="text-[13px] text-slate-500">{names.get(h.actorId ?? "") ?? "System"} · {fmtDate(h.createdAt, true)}</div>
                </li>
              ))}
            </ol>
          ) : <Empty>No changes recorded since this record was created.</Empty>}
        </Card>
      ) : null}
      </div>
    </div>
  );
}

/** An audit entry's action as a short sentence ("serviceUser.keysafe.viewed" → "Keysafe viewed"). */
function humanAction(action: string) {
  const t = action.replace(/^serviceUser\./, "").replace(/[._]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Record changed";
}

type ContactRow = { kind: string; name: string; relationship: string | null; phone: string | null; altPhone: string | null; email: string | null; isEmergency: boolean; canReceiveUpdates: boolean; isPrimary: boolean; preferredContactMethod: string | null; authorityType: string | null; authorityScope: string | null };

/** The contact fields, shared by Add contact and Edit. Optional fields stay empty unless the office fills them in. */
function ContactFields({ c }: { c?: ContactRow }) {
  return (
    <>
      <label><span className="label">Type</span><select name="kind" defaultValue={c?.kind} className="input">{Object.entries(CONTACT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label><span className="label">Name</span><input name="name" required defaultValue={c?.name} className="input" /></label>
      <label><span className="label">Relationship</span><input name="relationship" defaultValue={c?.relationship ?? ""} className="input" /></label>
      <label><span className="label">Phone</span><input name="phone" type="tel" defaultValue={c?.phone ?? ""} className="input" /></label>
      <label><span className="label">Alternative phone</span><input name="altPhone" type="tel" defaultValue={c?.altPhone ?? ""} className="input" /></label>
      <label><span className="label">E-mail</span><input name="email" type="email" defaultValue={c?.email ?? ""} className="input" /></label>
      <label><span className="label">Prefers to be contacted by</span><select name="preferredContactMethod" defaultValue={c?.preferredContactMethod ?? ""} className="input"><option value="">Not recorded</option><option value="PHONE">Telephone</option><option value="SMS">Text message</option><option value="EMAIL">Email</option><option value="OTHER">Other</option></select></label>
      <label><span className="label">Recorded authority to act</span><select name="authorityType" defaultValue={c?.authorityType ?? ""} className="input"><option value="">None recorded</option>{Object.entries(AUTHORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="md:col-span-2"><span className="label">What the authority covers (optional)</span><input name="authorityScope" maxLength={500} defaultValue={c?.authorityScope ?? ""} className="input" placeholder="For example: health and welfare decisions, registered with the OPG" /></label>
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="isPrimary" defaultChecked={c?.isPrimary} className="h-4 w-4" /> Primary contact</label>
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="isEmergency" defaultChecked={c?.isEmergency} className="h-4 w-4" /> Emergency contact</label>
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="canReceiveUpdates" defaultChecked={c?.canReceiveUpdates} className="h-4 w-4" /> Can receive updates</label>
    </>
  );
}
