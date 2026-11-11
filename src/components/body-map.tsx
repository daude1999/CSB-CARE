import { ArrowSquareOut, CalendarBlank, ClipboardText, FirstAidKit, Pill, Plus, Printer, ShieldCheck, Sparkle, UserCircle, Warning, WarningCircle, X } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import Link from "@/components/link";
import { addDays, dbDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { memberNames } from "@/server/rota/queries";
import { INCIDENT_CATEGORIES } from "@/server/care/incidents";
import { BODY_MAP_VIEWS, BODY_REGIONS, MAX_PHOTOS_PER_SAVE, OBSERVATION_CATEGORIES, PAIN_LEVELS, linkableIncidents, listObservations, observationAudit, painLabel, reviewerChoices } from "@/server/care/body-map";
import { REC_CATEGORY_LABEL, REC_STATUS_LABEL, bodyMapAiAvailability, escalationPrompts, recommendationRuns } from "@/server/care/body-map-ai";
import { linkedRecords } from "@/server/care/body-map-links";
import { TASK_KINDS, TASK_KIND_KEYS, assignablePeople, type TaskKind } from "@/server/care/body-map-tasks";
import { applicationSites } from "@/server/care/medication-sites";
import { ROUTE_LABEL, OUTCOME_LABEL } from "@/server/care/medication";
import { MAX_DOCUMENT_BYTES } from "@/server/care/su-documents";
import {
  bodyMapIncidentAction, bodyMapPhotoAction, bodyMapRecDecisionAction, bodyMapRecTaskAction, bodyMapTaskAction, closeBodyMapTaskAction, endMedicationSiteAction, generateBodyMapRecsAction,
  medicationSiteAction, noteBodyMapAction, recordBodyMapAction, reviewBodyMapAction, reviewerBodyMapAction,
} from "@/app/su-record-actions";
import { BodyMapWorkspace, type Marker, type View } from "@/components/body-map-figure";
import { ClearDraft } from "@/components/body-map-clear-draft";
import { PhotoButton, PrintButton } from "@/components/print-button";
import { PrivateFileInput } from "@/components/private-file-input";
import { Badge, Empty, fmtDate } from "@/components/ui";

const PHOTO_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.tif,.tiff";
const DISCLAIMER = "AI-generated suggestions are intended to support staff review. They do not replace clinical judgement, safeguarding procedures or professional assessment.";

type Obs = Awaited<ReturnType<typeof listObservations>>[number];
type Pane = "details" | "photos" | "history" | "links" | "followup" | "ai" | "audit";
const PANES: Pane[] = ["details", "photos", "history", "links", "followup", "ai", "audit"];

export interface BodyMapParams { obs?: string; record?: string; site?: string; pane?: string; view?: string; x?: string; y?: string; region?: string; category?: string; saved?: string }

function followUpState(o: Obs, today: Date) {
  if (o.status === "RESOLVED") return { label: "Resolved", tone: "green" as const };
  if (!o.followUpOn) return { label: "No follow-up set", tone: "slate" as const };
  if (o.followUpOn < today) return { label: `Follow-up overdue (${fmtDate(o.followUpOn)})`, tone: "rose" as const };
  return { label: `Follow-up ${fmtDate(o.followUpOn)}`, tone: "amber" as const };
}

function decisionBadge(o: Obs) {
  if (o.incidentDecision === "LINKED" && o.incident) return <Badge tone="violet">Incident {o.incident.reference}</Badge>;
  if (o.incidentDecision === "NOT_REQUIRED") return <Badge>No incident needed</Badge>;
  return <Badge tone="amber">Awaiting manager review</Badge>;
}

const REC_TONE: Record<string, "slate" | "violet" | "amber" | "green" | "teal"> = { NEW: "violet", UNDER_REVIEW: "amber", ACCEPTED: "green", DISMISSED: "slate", ACTION_CREATED: "teal" };

const AUDIT_LABEL: Record<string, string> = {
  "bodyMap.recorded": "Observation recorded", "bodyMap.followedUp": "Follow-up recorded", "bodyMap.resolved": "Marked resolved", "bodyMap.noteAdded": "Note added",
  "bodyMap.photoAdded": "Photograph added", "bodyMap.photoViewed": "Photograph viewed", "bodyMap.incidentLinked": "Incident decision: linked", "bodyMap.incidentNotRequired": "Incident decision: not needed",
  "bodyMap.reviewerAssigned": "Reviewer assigned", "bodyMap.taskCreated": "Task created", "bodyMap.taskDone": "Task completed", "bodyMap.taskCancelled": "Task cancelled",
  "bodyMap.ai.generated": "AI recommendations generated", "bodyMap.ai.failed": "AI recommendations failed", "bodyMap.ai.reviewStarted": "Suggestion taken under review",
  "bodyMap.ai.accepted": "Suggestion accepted", "bodyMap.ai.dismissed": "Suggestion dismissed",
};

const obsRef = (id: string) => `OB-${id.slice(-6).toUpperCase()}`;
const photoUrl = (id: string) => `/api/service-users/body-map/photos/${id}`;
const Hidden = ({ v }: { v: Record<string, string | number> }) => <>{Object.entries(v).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}</>;

/**
 * The Digital Body Map section of a service user's profile, laid out like the approved reference: the outline and its
 * tools (left), the register or the Record Observation form (centre), and the selected observation (right) with its
 * details, photos, history, linked records, follow-up and review, AI-assisted recommendations and audit trail.
 */
export async function BodyMapSection({ ctx, serviceUserId, personName, base, sp }: { ctx: Ctx; serviceUserId: string; personName: string; base: string; sp: BodyMapParams }) {
  const canRecord = hasOrgPermission(ctx, "bodyMap.record");
  const canPhotos = hasOrgPermission(ctx, "bodyMap.photos");
  const canDecide = hasOrgPermission(ctx, "incident.manage");
  const canReview = hasOrgPermission(ctx, "bodyMap.review");
  const here = `${base}?tab=bodymap`;
  const [obs, meds] = await Promise.all([listObservations(ctx, serviceUserId), applicationSites(ctx, serviceUserId)]);
  const canSites = meds.enabled && hasOrgPermission(ctx, "medication.manage");
  const recording = sp.record === "1" && canRecord;
  const siting = !recording && sp.site === "1" && canSites;
  const numbered = [...obs].reverse().map((o, i) => ({ o, n: i + 1 }));
  const numberOf = new Map(numbered.map(({ o, n }) => [o.id, n]));
  const selected = obs.find((o) => o.id === sp.obs) ?? null;
  const pane: Pane = PANES.includes(sp.pane as Pane) ? (sp.pane as Pane) : "details";
  const today = dbDate(londonDate());
  const markers: Marker[] = numbered.map(({ o, n }) => ({ id: o.id, n, view: o.view, x: o.x, y: o.y, open: o.status === "OPEN", category: o.category, label: `${o.category}, ${o.region}, ${fmtDate(o.observedAt)}`, href: `${here}&obs=${o.id}`, selected: o.id === selected?.id }));
  const siteMarkers = meds.sites.map((s) => ({ id: s.id, view: s.view as View, x: s.x, y: s.y, label: `${s.medication.name}, ${s.region}` }));
  const outstanding = obs.filter((o) => o.status === "OPEN" && o.followUpOn);
  const overdue = outstanding.filter((o) => o.followUpOn! < today).length;
  const awaiting = obs.filter((o) => !o.incidentDecision).length;
  const recsAwaiting = obs.reduce((n, o) => n + o.recommendations.filter((r) => r.status === "NEW" || r.status === "UNDER_REVIEW").length, 0);
  const tasksOpen = obs.reduce((n, o) => n + o.tasks.filter((t) => t.status === "OPEN").length, 0);
  const reviewers = canRecord ? await reviewerChoices(ctx.organisationId!) : [];
  const v = (sp.view && sp.view in BODY_MAP_VIEWS ? sp.view : selected?.view ?? "FRONT") as View;
  const num = (s?: string) => (s && Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 100 ? Number(s) : undefined);
  const selHere = selected ? `${here}&obs=${selected.id}` : here;

  const register = (
    <section className="bm-card" aria-label="Observations">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="bm-h3">Observations</h3>
        <span className="text-meta text-slate-500">{obs.length} recorded</span>
      </div>
      {obs.length ? (
        <ul className="divide-y divide-[#f2f4f7]" data-testid="body-map-list">
          {obs.map((o) => {
            const f = followUpState(o, today);
            return (
              <li key={o.id} className={`-mx-2 rounded-[8px] px-2 py-2.5 ${o.id === selected?.id ? "bg-[#f4f3ff]" : ""}`}>
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold text-white" style={{ background: o.status === "OPEN" ? colour(o.category) : "#98a2b3" }}>{numberOf.get(o.id)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><Link href={`${here}&obs=${o.id}`} className="text-body font-semibold text-[#101828] hover:text-[#5b2bb5]">{o.category} – {o.region}</Link><Badge tone={f.tone}>{f.label}</Badge></div>
                    <p className="text-caption text-slate-600">{fmtDate(o.observedAt)}, {londonTime(o.observedAt)} · {BODY_MAP_VIEWS[o.view].toLowerCase()}{o.photos.length ? ` · ${o.photos.length} photo${o.photos.length === 1 ? "" : "s"}` : ""}{o.notes.length ? ` · ${o.notes.length} note${o.notes.length === 1 ? "" : "s"}` : ""}</p>
                    <p className="mt-1">{decisionBadge(o)}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <Empty>No body map observations recorded.{canRecord ? " Use Record Observation to add one." : ""}</Empty>}
      {meds.enabled ? (
        <div className="mt-4 border-t border-[#eaecf0] pt-3" data-testid="body-map-med-sites">
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="bm-h4">Medication application sites</h4>{canSites ? <Link href={`${here}&site=1`} className="bm-secondary bm-small">Record application site</Link> : null}</div>
          <p className="text-caption text-slate-500">Where creams and patches are applied (square markers). Not skin observations, and not a record that a dose was given.</p>
          {meds.sites.length ? (
            <ul className="mt-2 space-y-1.5 text-meta">
              {meds.sites.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-medium">{s.medication.name}</span> · {s.region} ({BODY_MAP_VIEWS[s.view].toLowerCase()}){s.note ? ` · ${s.note}` : ""}</span>
                  {canSites ? (
                    <details><summary className="cursor-pointer text-meta font-medium text-[#5b2bb5]">End site</summary>
                      <form action={endMedicationSiteAction} className="mt-1 flex gap-2"><Hidden v={{ back: here, siteId: s.id }} /><input name="reason" required minLength={3} className="input" placeholder="Why it is no longer used" aria-label="Reason" /><button className="bm-secondary bm-small">End</button></form>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-meta text-slate-600">No application sites recorded.</p>}
          {meds.topical.filter((t) => !t.hasSite).length ? <p className="mt-2 text-meta text-[#8a5a00]">No site recorded for: {meds.topical.filter((t) => !t.hasSite).map((t) => t.name).join(", ")}.</p> : null}
        </div>
      ) : null}
    </section>
  );

  return (
    <div className="space-y-3" data-testid="body-map">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="bm-h2">Digital Body Map</h2>
          <p className="mt-0.5 text-body text-slate-600">Record and track skin integrity, injuries and other physical observations with photographs, follow-ups and history. Describe what you see; do not diagnose.</p>
          <p className="mt-2 flex flex-wrap gap-1.5 text-meta" data-testid="body-map-counts">
            <Badge tone={outstanding.length ? "amber" : "slate"}>{outstanding.length} outstanding follow-up{outstanding.length === 1 ? "" : "s"}</Badge>
            {overdue ? <Badge tone="rose">{overdue} overdue</Badge> : null}
            <Badge tone={awaiting ? "amber" : "slate"}>{awaiting} awaiting manager review</Badge>
            {recsAwaiting ? <Badge tone="violet">{recsAwaiting} suggestion{recsAwaiting === 1 ? "" : "s"} awaiting decision</Badge> : null}
            {tasksOpen ? <Badge tone="teal">{tasksOpen} open task{tasksOpen === 1 ? "" : "s"}</Badge> : null}
            <Badge>{obs.filter((o) => o.status === "RESOLVED").length} resolved</Badge>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintButton className="bm-secondary"><Printer size={17} aria-hidden /> Print</PrintButton>
          {canRecord && !recording ? <Link href={`${here}&record=1${selected ? `&obs=${selected.id}` : ""}`} className="bm-primary"><Plus size={16} weight="bold" aria-hidden /> Record Observation</Link> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1.42fr)_minmax(560px,1fr)] xl:grid-cols-[minmax(0,1.25fr)_minmax(500px,1fr)]">
        <BodyMapWorkspace
          mode={recording ? "record" : siting ? "site" : "browse"}
          markers={markers}
          sites={siteMarkers}
          regions={BODY_REGIONS}
          categories={OBSERVATION_CATEGORIES.map((c) => ({ name: c, count: obs.filter((o) => o.category === c).length }))}
          initial={{ view: v, x: num(sp.x), y: num(sp.y), region: sp.region, category: sp.category && (OBSERVATION_CATEGORIES as readonly string[]).includes(sp.category) ? sp.category : undefined }}
          recordHref={`${here}&record=1${selected ? `&obs=${selected.id}` : ""}`}
          canRecord={canRecord}
          record={recording ? {
            action: recordBodyMapAction, serviceUserId, personName, back: `${here}&record=1${selected ? `&obs=${selected.id}` : ""}`, cancelHref: selHere, today: londonDate(), now: londonTime(new Date()),
            pain: Object.entries(PAIN_LEVELS).map(([value, label]) => ({ value, label })), reviewers, canPhotos, photoAccept: PHOTO_ACCEPT, maxBytes: MAX_DOCUMENT_BYTES, maxPhotos: MAX_PHOTOS_PER_SAVE, clearDraft: false,
          } : undefined}
          site={siting ? { action: medicationSiteAction, serviceUserId, back: `${here}&site=1`, cancelHref: here, medicines: meds.topical.map((t) => ({ id: t.id, label: `${t.name}${t.strength ? ` ${t.strength}` : ""} · ${ROUTE_LABEL[t.route as keyof typeof ROUTE_LABEL] ?? t.route}${t.hasSite ? " (has a site)" : ""}` })) } : undefined}
        >
          {register}
        </BodyMapWorkspace>
        {sp.saved === "1" ? <ClearDraft serviceUserId={serviceUserId} /> : null}

        <aside className="bm-card min-w-0" aria-label="Selected observation" data-testid="body-map-detail">
          {!selected ? (
            <Empty>Choose an observation on the outline or in the list to see its details, notes, photos, linked records and history.</Empty>
          ) : (
            <ObservationDetail ctx={ctx} o={selected} n={numberOf.get(selected.id)!} all={obs} pane={pane} here={here} today={today} canRecord={canRecord} canPhotos={canPhotos} canDecide={canDecide} canReview={canReview} reviewers={reviewers} />
          )}
        </aside>
      </div>
    </div>
  );
}


async function ObservationDetail({ ctx, o, n, all, pane, here, today, canRecord, canPhotos, canDecide, canReview, reviewers }: {
  ctx: Ctx; o: Obs; n: number; all: Obs[]; pane: Pane; here: string; today: Date; canRecord: boolean; canPhotos: boolean; canDecide: boolean; canReview: boolean; reviewers: { id: string; name: string }[];
}) {
  const at = `${here}&obs=${o.id}`;
  const back = `${at}&pane=${pane}`;
  const f = followUpState(o, today);
  const sameArea = all.filter((x) => x.view === o.view && x.region === o.region).sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const earlier30 = sameArea.filter((x) => x.id !== o.id && x.observedAt < o.observedAt && x.observedAt.getTime() > o.observedAt.getTime() - 30 * 86400_000).length;
  const prompts = escalationPrompts(o, earlier30);
  const [links, runs, audits, ai, incidents, people] = await Promise.all([
    canRecord ? linkedRecords(ctx, o.id) : Promise.resolve(null),
    canRecord ? recommendationRuns(ctx, o.id) : Promise.resolve([]),
    canRecord && pane === "audit" ? observationAudit(ctx, o.id) : Promise.resolve([]),
    bodyMapAiAvailability(ctx),
    canDecide ? linkableIncidents(ctx, o.serviceUserId) : Promise.resolve([]),
    canReview ? Promise.all(TASK_KIND_KEYS.map(async (k) => [k, await assignablePeople(ctx, k)] as const)).then((xs) => new Map(xs)) : Promise.resolve(new Map<TaskKind, { id: string; name: string }[]>()),
  ]);
  const current = runs.find((r) => !r.supersededAt && r.status !== "FAILED") ?? null;
  const lastFailed = runs[0]?.status === "FAILED" ? runs[0] : null;
  const earlierRuns = runs.filter((r) => r !== current && r.status !== "FAILED");
  const names = await memberNames(ctx, [o.recordedById, o.reviewerId, o.incidentDecidedById, ...o.reviews.map((r) => r.reviewedById), ...o.notes.map((x) => x.authorId), ...o.photos.map((p) => p.uploadedById), ...o.tasks.flatMap((t) => [t.assigneeId, t.createdById, t.closedById]), ...runs.flatMap((r) => [r.requestedById, ...r.recommendations.flatMap((x) => [x.decidedById, x.reviewStartedById])]), ...audits.map((a) => a.actorId)]);
  const who = (id: string | null | undefined) => (id ? names.get(id) ?? "Former member" : "—");
  const openRecs = current?.recommendations.filter((r) => r.status === "NEW" || r.status === "UNDER_REVIEW").length ?? 0;
  const firstPhoto = o.photos[0];
  const tabs: [Pane, string, number | null][] = [["details", "Details", null], ["photos", "Photos", o.photos.length], ["history", "History", o.notes.length + o.reviews.length], ...(canRecord ? ([["links", "Linked Records", null], ["followup", "Follow-up", o.tasks.filter((t) => t.status === "OPEN").length || null], ["ai", "AI Suggestions", openRecs || null], ["audit", "Audit Trail", null]] as [Pane, string, number | null][]) : [])];
  const recTask = (r: { actionKind: string | null }) => (r.actionKind && r.actionKind in TASK_KINDS ? (r.actionKind as TaskKind) : "MANAGER_REVIEW");
  const defaultDue = addDays(londonDate(), 3);

  return (
    <div className="text-body">
      <div className="flex items-start gap-3">
        <span className="bm-icon"><ClipboardText size={20} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="bm-h3">{o.category} – {o.region}</h3><span className={`bm-pill ${o.status === "OPEN" ? "bg-[#ecfdf3] text-[#067647]" : "bg-[#f2f4f7] text-[#344054]"}`}>{o.status === "OPEN" ? "Open" : "Resolved"}</span></div>
          <p className="text-caption text-slate-500">Observation {n} · ID: {obsRef(o.id)} · Created: {fmtDate(o.recordedAt, true)}</p>
        </div>
        <Link href={here} aria-label="Close the observation" className="text-slate-500 hover:text-slate-900"><X size={20} aria-hidden /></Link>
      </div>

      <nav className="bm-tabs mt-3" aria-label="Observation sections">
        {tabs.map(([k, label, count]) => <Link key={k} href={`${at}&pane=${k}`} className="bm-tab" aria-current={pane === k ? "page" : undefined}>{label}{count ? ` (${count})` : ""}</Link>)}
      </nav>

      <div className="mt-3 space-y-3" data-testid={`body-map-pane-${pane}`}>
        {prompts.length && (pane === "details" || pane === "ai") ? (
          <div className="bm-callout" role="note" data-testid="body-map-escalation">
            <p className="flex items-center gap-1.5 font-semibold"><WarningCircle size={17} aria-hidden /> Follow your escalation procedure</p>
            <ul className="mt-1 list-disc pl-5">{prompts.map((p) => <li key={p.code}>{p.reason}</li>)}</ul>
            <p className="mt-1">Follow the organisation&apos;s escalation procedure and seek qualified professional assessment where needed.{prompts.some((p) => p.kind === "SAFEGUARDING") ? " An authorised manager should consider whether the safeguarding procedure applies. This is not a conclusion that abuse has occurred." : ""} This prompt comes from fixed rules, not AI.</p>
          </div>
        ) : null}

        {pane === "details" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
              <dl className="bm-dl">
                <dt>Type</dt><dd className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colour(o.category) }} />{o.category}</dd>
                <dt>Location</dt><dd>{o.region} ({BODY_MAP_VIEWS[o.view].toLowerCase()}){o.locationDetail ? ` · ${o.locationDetail}` : ""}</dd>
                <dt>Date &amp; Time Observed</dt><dd>{fmtDate(o.observedAt, true)}</dd>
                <dt>Recorded By</dt><dd>{who(o.recordedById)}</dd>
                <dt>Description</dt><dd className="whitespace-pre-line">{o.description}</dd>
                <dt>Size</dt><dd>{o.size ?? "—"}</dd>
                <dt>Colour / Appearance</dt><dd>{o.appearance ?? "—"}</dd>
                <dt>Pain / Discomfort</dt><dd>{painLabel(o.pain)}</dd>
                <dt>Action Taken</dt><dd className="whitespace-pre-line">{o.actionTaken ?? "—"}</dd>
                <dt>Person Notified</dt><dd>{o.personNotified ?? "—"}</dd>
              </dl>
              <div>
                {canPhotos && firstPhoto ? (
                  <a href={photoUrl(firstPhoto.id)} target="_blank" rel="noopener" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrl(firstPhoto.id)} alt={firstPhoto.caption ?? `Photo of ${o.category.toLowerCase()}`} className="h-[150px] w-full rounded-[10px] border border-[#eaecf0] bg-slate-50 object-cover" />
                  </a>
                ) : <div className="flex h-[150px] items-center justify-center rounded-[10px] border border-dashed border-[#d0d5dd] text-center text-caption text-slate-500">{o.photos.length && !canPhotos ? "Your role cannot view body map photographs" : "No photograph"}</div>}
                <div className="mt-2 flex gap-2">
                  {canPhotos ? o.photos.slice(1, 3).map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a key={p.id} href={photoUrl(p.id)} target="_blank" rel="noopener"><img src={photoUrl(p.id)} alt={p.caption ?? "Photo"} className="h-[52px] w-[60px] rounded-[8px] border border-[#eaecf0] object-cover" /></a>
                  )) : null}
                  {canRecord && canPhotos ? <Link href={`${at}&pane=photos#add-photo`} className="flex h-[52px] w-[60px] flex-col items-center justify-center rounded-[8px] border border-[#eaecf0] text-micro text-[#344054]"><Plus size={15} aria-hidden />Add Photo</Link> : null}
                </div>
              </div>
            </div>

            {links ? (
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="body-map-link-cards">
                <LinkCard icon={<Warning size={17} className="text-[#d92d20]" aria-hidden />} title="Incident" href={`${at}&pane=links`}>
                  {o.incident ? <>Linked: <Link href={`/rota/incidents/${o.incident.id}`}>{o.incident.reference}</Link></> : o.incidentDecision === "NOT_REQUIRED" ? "Not needed" : <span className="text-[#8a5a00]">Decision due</span>}
                </LinkCard>
                <LinkCard icon={<Pill size={17} className="text-[#0e7490]" aria-hidden />} title="Medication (Topical)" href={`${at}&pane=links`}>
                  {!links.medication.enabled ? "Records switched off" : links.medication.sameArea.length ? `${links.medication.sameArea.length} site${links.medication.sameArea.length === 1 ? "" : "s"} here` : "No medication linked"}
                </LinkCard>
                <LinkCard icon={<ClipboardText size={17} className="text-[#5b2bb5]" aria-hidden />} title="Care Plan" href={`${at}&pane=links`}>
                  {links.carePlan ? <>Version {links.carePlan.version}{links.carePlan.sections.length ? `, ${links.carePlan.sections.length} relevant` : ""}</> : "No active plan"}
                </LinkCard>
                <LinkCard icon={<ShieldCheck size={17} className="text-[#5b2bb5]" aria-hidden />} title="Risk Assessment" href={`${at}&pane=links`}>
                  {links.risks.length ? `${links.risks.length} relevant` : "None found"}
                </LinkCard>
              </div>
            ) : null}

            <div className="bm-block" data-testid="body-map-followup-summary">
              <div className="flex flex-wrap items-center gap-3">
                <CalendarBlank size={20} className="text-[#5b2bb5]" aria-hidden />
                <p className="bm-h4 flex-1">Follow-up &amp; Review</p>
                {canRecord ? <Link href={`${at}&pane=followup`} className="bm-primary bm-small">Update Review</Link> : null}
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-meta">
                <div><dt className="text-slate-500">Next Review</dt><dd className="font-semibold text-[#101828]">{o.status === "RESOLVED" ? "None (resolved)" : o.followUpOn ? fmtDate(o.followUpOn) : "Not set"}</dd></div>
                <div><dt className="text-slate-500">Assigned To</dt><dd className="flex items-center gap-1 text-[#101828]"><UserCircle size={15} aria-hidden />{o.reviewerId ? who(o.reviewerId) : "Not assigned"}</dd></div>
                <div><dt className="text-slate-500">Status</dt><dd><Badge tone={f.tone}>{f.label}</Badge></dd></div>
              </dl>
            </div>

            {canRecord ? <NoteForm o={o} back={back} canPhotos={canPhotos} /> : null}

            {canRecord ? (
              <div className="bm-ai flex flex-wrap items-center gap-2 text-meta" data-testid="body-map-ai-summary">
                <Sparkle size={17} className="text-[#5b2bb5]" aria-hidden />
                <span className="flex-1"><span className="font-semibold">AI-Assisted Recommendations: </span>{ai.state === "off" ? "switched off for your organisation." : ai.state === "not_configured" ? "no AI provider configured." : current ? `${current.recommendations.length} suggestion${current.recommendations.length === 1 ? "" : "s"}, ${openRecs} awaiting a decision.` : "none yet."}</span>
                <Link href={`${at}&pane=ai`} className="text-meta font-medium text-[#5b2bb5]">Open</Link>
              </div>
            ) : null}
          </>
        ) : null}

        {pane === "photos" ? (
          <>
            {!canPhotos ? <p className="text-slate-600">{o.photos.length ? `${o.photos.length} photo(s). Your role cannot view body map photographs.` : "No photographs."}</p> : o.photos.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="body-map-photos">
                {o.photos.map((p) => (
                  <li key={p.id} className="text-caption text-slate-600">
                    <a href={photoUrl(p.id)} target="_blank" rel="noopener">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photoUrl(p.id)} alt={p.caption ?? `Photo of ${o.category.toLowerCase()}`} className="h-28 w-full rounded-[8px] border border-[#eaecf0] bg-slate-50 object-cover" />
                    </a>
                    {fmtDate(p.uploadedAt, true)} · {who(p.uploadedById)}{p.caption ? ` · ${p.caption}` : ""}{p.noteId ? " · with a note" : ""}
                  </li>
                ))}
              </ul>
            ) : <p className="text-slate-600">No photographs.</p>}
            {canPhotos ? <PhotoCompare items={sameArea} current={o.id} here={here} /> : null}
            {canRecord && canPhotos ? (
              <form id="add-photo" action={bodyMapPhotoAction} className="bm-block space-y-2">
                <Hidden v={{ back, observationId: o.id }} />
                <PrivateFileInput name="photo" required accept={PHOTO_ACCEPT} maxBytes={MAX_DOCUMENT_BYTES} label="Add a photograph" hint="Only with the person's consent. Kept privately; up to 4 MB." />
                <label className="block"><span className="bm-label">Caption</span><input name="caption" maxLength={200} className="input" /></label>
                <button className="bm-secondary bm-small">Add photo</button>
              </form>
            ) : null}
            <p className="text-caption text-slate-500">Photographs are never changed or sent to an AI provider. Every view is recorded in the audit trail.</p>
          </>
        ) : null}

        {pane === "history" ? (
          <>
            <Timeline o={o} runs={runs} who={who} />
            {sameArea.length > 1 ? (
              <div>
                <h4 className="bm-h4 mb-1">Recorded measurements: {o.region}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-meta" data-testid="body-map-compare">
                    <thead className="text-left text-slate-500"><tr><th className="py-1 pr-2 font-medium">Observed</th><th className="py-1 pr-2 font-medium">Type</th><th className="py-1 pr-2 font-medium">Size</th><th className="py-1 pr-2 font-medium">Appearance</th><th className="py-1 pr-2 font-medium">Status</th></tr></thead>
                    <tbody>{sameArea.map((c) => <tr key={c.id} className={`border-t border-[#f2f4f7] ${c.id === o.id ? "bg-[#f4f3ff]" : ""}`}><td className="py-1 pr-2"><Link href={`${here}&obs=${c.id}&pane=history`}>{fmtDate(c.observedAt)}</Link></td><td className="py-1 pr-2">{c.category}</td><td className="py-1 pr-2">{c.size ?? "not recorded"}</td><td className="py-1 pr-2">{c.appearance ?? "—"}</td><td className="py-1 pr-2">{c.status === "OPEN" ? "Open" : "Resolved"}</td></tr>)}</tbody>
                  </table>
                </div>
                <p className="mt-1 text-caption text-slate-500">These are the measurements as recorded. The system does not judge whether the area is getting better or worse.</p>
              </div>
            ) : null}
          </>
        ) : null}

        {pane === "links" && links ? (
          <>
            <section aria-labelledby="bm-inc-h">
              <h4 id="bm-inc-h" className="bm-h4 mb-1 flex items-center gap-1.5"><FirstAidKit size={16} aria-hidden /> Incident and safeguarding</h4>
              <p>{decisionBadge(o)}{o.incidentDecidedAt ? <span className="ml-1 text-meta text-slate-600">by {who(o.incidentDecidedById)}, {fmtDate(o.incidentDecidedAt, true)}{o.incidentDecisionNote ? `: ${o.incidentDecisionNote}` : ""}</span> : null}</p>
              {links.incidents.length ? (
                <ul className="mt-1.5 space-y-1 text-meta">
                  {links.incidents.map((i) => <li key={i.id}><Link href={`/rota/incidents/${i.id}`}>{i.reference}</Link> · {i.category} · {i.status.toLowerCase()}{i.safeguarding ? " · safeguarding" : ""} · {fmtDate(i.occurredAt)}{i.linked ? <Badge tone="violet">Linked</Badge> : null}</li>)}
                </ul>
              ) : <p className="mt-1 text-meta text-slate-600">No open incidents for this person.</p>}
              {canDecide ? <IncidentDecision o={o} back={back} incidents={incidents} /> : !o.incidentDecision ? <p className="mt-1 text-meta text-slate-500">A manager will decide whether an incident report is needed.</p> : null}
            </section>
            <section aria-labelledby="bm-med-h" className="border-t border-[#eaecf0] pt-3">
              <h4 id="bm-med-h" className="bm-h4 mb-1 flex items-center gap-1.5"><Pill size={16} aria-hidden /> Medication (topical and patches)</h4>
              {!links.medication.enabled ? <p className="text-meta text-slate-600">Medication records are switched off for your organisation, or your role cannot see them.</p> : (
                <>
                  {links.medication.sameArea.length ? (
                    <ul className="space-y-2 text-meta">
                      {links.medication.sameArea.map((s) => (
                        <li key={s.id} className="bm-block">
                          <p className="font-medium">{s.medication.name}{s.medication.strength ? ` ${s.medication.strength}` : ""} · {s.medication.dose} · {ROUTE_LABEL[s.medication.route as keyof typeof ROUTE_LABEL] ?? s.medication.route}</p>
                          <p className="text-slate-600">Instructions: {s.medication.instructions ?? "none recorded"}{s.note ? ` · Site note: ${s.note}` : ""}</p>
                          <p className="text-caption text-slate-500">Last recorded on the MAR: {s.medication.records.length ? s.medication.records.map((r) => `${OUTCOME_LABEL[r.outcome]} ${fmtDate(r.at, true)}`).join("; ") : "nothing yet"}. <Link href={`/rota/service-users/${links.serviceUserId}?tab=medication`}>Open medication and MAR</Link></p>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-meta text-slate-600">No medication application site is documented for {o.region.toLowerCase()}.</p>}
                  {links.medication.noSite.length ? <p className="mt-1 text-meta text-[#8a5a00]">No application site recorded for: {links.medication.noSite.map((m) => m.name).join(", ")}. An authorised manager can record one from the body map.</p> : null}
                  <p className="mt-1 text-caption text-slate-500">Application sites are not skin observations. Doses are only recorded on the visit (MAR); nothing on the body map creates one.</p>
                </>
              )}
            </section>
            <section aria-labelledby="bm-cp-h" className="border-t border-[#eaecf0] pt-3">
              <h4 id="bm-cp-h" className="bm-h4 mb-1 flex items-center gap-1.5"><ClipboardText size={16} aria-hidden /> Care plan</h4>
              {links.carePlan ? (
                <p className="text-meta"><Link href={`/rota/care-plans/${links.serviceUserId}`}>Care plan version {links.carePlan.version}</Link>{links.carePlan.reviewDue ? ` · review due ${fmtDate(links.carePlan.reviewDue)}` : ""}{links.carePlan.sections.length ? <span className="block text-slate-600">Relevant sections: {links.carePlan.sections.map((s) => s.title).join(", ")}</span> : <span className="block text-slate-600">No section mentions skin, pressure or personal care.</span>}</p>
              ) : <p className="text-meta text-slate-600">No active care plan.</p>}
            </section>
            <section aria-labelledby="bm-ra-h" className="border-t border-[#eaecf0] pt-3">
              <h4 id="bm-ra-h" className="bm-h4 mb-1 flex items-center gap-1.5"><ShieldCheck size={16} aria-hidden /> Risk assessments</h4>
              {links.risks.length ? <ul className="space-y-1 text-meta">{links.risks.map((r) => <li key={r.id}><Link href={`/rota/risks/${r.id}`}>{r.title}</Link> · {r.level.toLowerCase()} risk · review due {fmtDate(r.reviewDue)}{r.reviewDue < today ? <Badge tone="rose">Overdue</Badge> : null}</li>)}</ul> : <p className="text-meta text-slate-600">No active skin, pressure, falls or moving and handling risk assessment.</p>}
            </section>
          </>
        ) : null}

        {pane === "followup" && canRecord ? (
          <>
            <div className="bm-block">
              <p className="bm-h4">Assigned reviewer</p>
              <p className="mt-0.5">{o.reviewerId ? who(o.reviewerId) : "Not assigned"}</p>
              {canReview ? (
                <form action={reviewerBodyMapAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <Hidden v={{ back, observationId: o.id, version: o.version }} />
                  <label className="min-w-[200px] flex-1"><span className="bm-label">Assign to</span><select name="reviewerId" required className="input" defaultValue={o.reviewerId ?? ""}><option value="">Choose…</option>{reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                  <button className="bm-secondary bm-small">Assign</button>
                </form>
              ) : null}
            </div>
            <div>
              <h4 className="bm-h4 mb-1">Follow-ups</h4>
              {o.reviews.length ? (
                <ol className="space-y-1.5" data-testid="body-map-reviews">
                  {o.reviews.map((r) => <li key={r.id} className="border-b border-[#f2f4f7] pb-1.5"><span className="whitespace-pre-line">{r.outcome}</span><span className="block text-caption text-slate-500">{fmtDate(r.reviewedAt, true)} · {who(r.reviewedById)}{r.resolved ? " · resolved" : r.nextFollowUpOn ? ` · next follow-up ${fmtDate(r.nextFollowUpOn)}` : ""}</span></li>)}
                </ol>
              ) : <p className="text-slate-600">No follow-ups yet.</p>}
              <form action={reviewBodyMapAction} className="bm-block mt-2 space-y-2">
                <Hidden v={{ back, observationId: o.id, version: o.version }} />
                <label className="block"><span className="bm-label">{o.status === "RESOLVED" ? "Reopen with a new finding" : "Follow-up outcome"}</span><textarea name="outcome" required minLength={5} rows={2} maxLength={4000} className="input" placeholder="What was seen at the follow-up, and any change" /></label>
                <div className="grid grid-cols-2 items-end gap-2">
                  <label><span className="bm-label">Next follow-up</span><input type="date" name="nextFollowUpOn" min={londonDate()} className="input" /></label>
                  <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="resolved" className="h-4 w-4" /> Resolved, no more follow-up</label>
                </div>
                <button className="bm-primary bm-small">Save follow-up</button>
              </form>
            </div>
            <div data-testid="body-map-tasks">
              <h4 className="bm-h4 mb-1">Review tasks</h4>
              {o.tasks.length ? (
                <ul className="space-y-2">
                  {o.tasks.map((t) => (
                    <li key={t.id} className="bm-block">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.title}</span><Badge tone={t.status === "OPEN" ? (fromDbDate(t.dueOn) < londonDate() ? "rose" : "amber") : t.status === "DONE" ? "green" : "slate"}>{t.status === "OPEN" ? `Due ${fmtDate(t.dueOn)}` : t.status === "DONE" ? "Done" : "Cancelled"}</Badge></div>
                      <p className="text-meta text-slate-600">{TASK_KINDS[t.kind as TaskKind]?.label ?? t.kind} · for {who(t.assigneeId)} · set by {who(t.createdById)} {fmtDate(t.createdAt, true)}{t.recommendationId ? " · from an AI-assisted suggestion" : ""}</p>
                      {t.details ? <p className="text-meta">{t.details}</p> : null}
                      {t.outcome ? <p className="text-meta text-slate-600">Outcome: {t.outcome} ({who(t.closedById)}, {fmtDate(t.closedAt, true)})</p> : null}
                      {t.status === "OPEN" && (t.assigneeId === ctx.userId || canReview) ? (
                        <form action={closeBodyMapTaskAction} className="mt-1.5 flex flex-wrap items-end gap-2">
                          <Hidden v={{ back, taskId: t.id, version: t.version }} />
                          <label className="min-w-[200px] flex-1"><span className="bm-label">Outcome</span><input name="outcome" required minLength={3} maxLength={2000} className="input" placeholder="What was done" /></label>
                          <button name="done" value="1" className="bm-secondary bm-small">Mark done</button>
                          {canReview ? <button name="done" value="0" className="bm-secondary bm-small">Cancel task</button> : null}
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-slate-600">No review tasks.</p>}
              {canReview ? (
                <details className="mt-2"><summary className="cursor-pointer text-meta font-medium text-[#5b2bb5]">Create a review task</summary>
                  <form action={bodyMapTaskAction} className="bm-block mt-2 grid gap-2 sm:grid-cols-2">
                    <Hidden v={{ back, observationId: o.id }} />
                    <label><span className="bm-label">Kind</span><select name="kind" className="input" defaultValue="FOLLOW_UP">{TASK_KIND_KEYS.map((k) => <option key={k} value={k}>{TASK_KINDS[k].label}</option>)}</select></label>
                    <label><span className="bm-label">For</span><select name="assigneeId" required className="input" defaultValue=""><option value="">Choose…</option>{uniquePeople(people).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                    <label><span className="bm-label">Due</span><input type="date" name="dueOn" required min={londonDate()} defaultValue={defaultDue} className="input" /></label>
                    <label className="sm:col-span-2"><span className="bm-label">Details</span><textarea name="details" rows={2} maxLength={2000} className="input" /></label>
                    <button className="bm-primary bm-small sm:col-span-2 sm:justify-self-start">Create task</button>
                  </form>
                </details>
              ) : null}
            </div>
          </>
        ) : null}

        {pane === "ai" && canRecord ? (
          <section aria-labelledby="bm-ai-h" data-testid="body-map-ai">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkle size={18} className="text-[#5b2bb5]" aria-hidden />
              <h4 id="bm-ai-h" className="bm-h4 flex-1">AI-Assisted Recommendations</h4>
              {ai.state === "ready" ? (
                <form action={generateBodyMapRecsAction}><Hidden v={{ back, observationId: o.id }} /><button className="bm-secondary bm-small">{current ? "Refresh recommendations" : "Generate recommendations"}</button></form>
              ) : null}
            </div>
            <p className="mt-1 text-caption text-slate-600">{DISCLAIMER}</p>
            {ai.state === "off" ? <p className="mt-2 rounded-[8px] bg-[#f9fafb] p-2.5 text-meta">Switched off for your organisation. An organisation admin can switch it on in <Link href="/rota/settings">Rota Settings</Link> once the data protection (DPIA) and clinical safety review is recorded. The body map works fully without it.</p> : null}
            {ai.state === "not_configured" ? <p className="mt-2 rounded-[8px] bg-[#f9fafb] p-2.5 text-meta">No AI provider is configured. The body map works fully without it.</p> : null}
            {lastFailed && !lastFailed.supersededAt ? <p className="mt-2 text-meta text-[#a3242c]" role="alert">The last attempt failed ({fmtDate(lastFailed.createdAt, true)}): {lastFailed.error}</p> : null}
            {current ? (
              <div className="mt-2 space-y-2">
                <p className="text-caption text-slate-500">
                  {current.isSimulated ? <Badge tone="amber">Simulated suggestions (demonstration only)</Badge> : <Badge tone="violet">{current.provider}{current.model ? ` · ${current.model}` : ""}</Badge>} Generated {fmtDate(current.createdAt, true)} {current.trigger === "AUTO" ? "automatically after saving" : `on request by ${who(current.requestedById)}`}, from {current.sources.length} record{current.sources.length === 1 ? "" : "s"}. Photographs are never sent.
                </p>
                {current.recommendations.length ? current.recommendations.map((r) => (
                  <article key={r.id} className="bm-ai" data-testid="body-map-rec">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1"><p className="text-caption font-medium uppercase tracking-wide text-[#6941c6]">{REC_CATEGORY_LABEL[r.category] ?? r.category}</p><h5 className="text-body font-semibold text-[#101828]">{r.title}</h5></div>
                      <Badge tone={REC_TONE[r.status] ?? "slate"}>{REC_STATUS_LABEL[r.status] ?? r.status}</Badge>
                    </div>
                    <p className="mt-1">{r.explanation}</p>
                    {r.facts.length ? <div className="mt-1.5"><p className="text-caption font-semibold text-[#344054]">Recorded facts</p><ul className="list-disc pl-5 text-meta text-slate-600">{r.facts.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null}
                    <p className="mt-1.5 text-meta"><span className="font-semibold">Suggested next action: </span>{r.suggestedAction}</p>
                    <p className="mt-1 text-caption text-slate-600">Supporting records: {r.sources.map((s, i) => <span key={s.sid}>{i ? ", " : ""}<Link href={s.href}>{s.label}</Link></span>)}</p>
                    {r.decidedAt ? <p className="mt-1 text-caption text-slate-500">{REC_STATUS_LABEL[r.status]} by {who(r.decidedById)}, {fmtDate(r.decidedAt, true)}{r.decisionNote ? `: ${r.decisionNote}` : ""}</p> : r.reviewStartedAt ? <p className="mt-1 text-caption text-slate-500">Under review by {who(r.reviewStartedById)} since {fmtDate(r.reviewStartedAt, true)}</p> : null}
                    {canReview && ["NEW", "UNDER_REVIEW", "ACCEPTED"].includes(r.status) ? (
                      <div className="mt-2 flex flex-wrap items-start gap-2">
                        {r.status === "NEW" ? <form action={bodyMapRecDecisionAction}><Hidden v={{ back, recommendationId: r.id, decision: "REVIEW" }} /><button className="bm-secondary bm-small">Review Suggestion</button></form> : null}
                        <details>
                          <summary className="bm-primary bm-small cursor-pointer list-none">Create Review Task</summary>
                          <form action={bodyMapRecTaskAction} className="mt-2 grid gap-2 rounded-[8px] border border-[#eaecf0] bg-white p-2.5 sm:grid-cols-2">
                            <Hidden v={{ back, recommendationId: r.id }} />
                            <label><span className="bm-label">Kind</span><select name="kind" className="input" defaultValue={recTask(r)}>{TASK_KIND_KEYS.map((k) => <option key={k} value={k}>{TASK_KINDS[k].label}</option>)}</select></label>
                            <label><span className="bm-label">For</span><select name="assigneeId" required className="input" defaultValue=""><option value="">Choose…</option>{(people.get(recTask(r)) ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                            <label><span className="bm-label">Due</span><input type="date" name="dueOn" required min={londonDate()} defaultValue={defaultDue} className="input" /></label>
                            <label className="sm:col-span-2"><span className="bm-label">Details</span><textarea name="details" rows={2} maxLength={2000} className="input" defaultValue={r.suggestedAction} /></label>
                            <button className="bm-primary bm-small sm:col-span-2 sm:justify-self-start">Create task</button>
                          </form>
                        </details>
                        {r.status !== "ACCEPTED" ? <form action={bodyMapRecDecisionAction}><Hidden v={{ back, recommendationId: r.id, decision: "ACCEPT" }} /><button className="bm-secondary bm-small">Accept</button></form> : null}
                        {r.status !== "ACCEPTED" ? (
                          <details>
                            <summary className="bm-secondary bm-small cursor-pointer list-none">Dismiss</summary>
                            <form action={bodyMapRecDecisionAction} className="mt-2 flex flex-wrap items-end gap-2">
                              <Hidden v={{ back, recommendationId: r.id, decision: "DISMISS" }} />
                              <label className="min-w-[200px] flex-1"><span className="bm-label">Reason{r.category === "INCIDENT_SAFEGUARDING" || r.category === "MEDICATION_REVIEW" ? " (required)" : " (optional)"}</span><input name="note" maxLength={1000} className="input" required={r.category === "INCIDENT_SAFEGUARDING" || r.category === "MEDICATION_REVIEW"} minLength={r.category === "INCIDENT_SAFEGUARDING" || r.category === "MEDICATION_REVIEW" ? 5 : undefined} /></label>
                              <button className="bm-secondary bm-small">Dismiss suggestion</button>
                            </form>
                          </details>
                        ) : null}
                        {r.sources[0] ? <Link href={r.sources[0].href} className="bm-secondary bm-small">View Supporting Record <ArrowSquareOut size={14} aria-hidden /></Link> : null}
                      </div>
                    ) : null}
                  </article>
                )) : <p className="rounded-[8px] bg-[#f9fafb] p-2.5 text-meta">No reliable recommendation could be made from the records.</p>}
                {current.gaps.length ? <div className="text-meta"><p className="font-semibold text-[#344054]">What the records do not show</p><ul className="list-disc pl-5 text-slate-600">{current.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></div> : null}
                <p className="text-caption text-slate-500">Accepting a suggestion is not a clinical or safeguarding decision. Tasks use the normal care plan, risk assessment and incident workflows.</p>
              </div>
            ) : ai.state === "ready" ? <p className="mt-2 text-meta text-slate-600">No recommendations yet. They are prepared automatically after a new observation is saved, or use Generate recommendations.</p> : null}
            {earlierRuns.length ? (
              <details className="mt-3"><summary className="cursor-pointer text-meta font-medium text-[#5b2bb5]">Earlier suggestions, based on older information ({earlierRuns.length})</summary>
                <ul className="mt-2 space-y-2 text-meta">
                  {earlierRuns.map((run) => (
                    <li key={run.id} className="bm-block">
                      <p className="text-slate-500">{fmtDate(run.createdAt, true)} · {run.isSimulated ? "simulated" : run.provider} · replaced {fmtDate(run.supersededAt, true)} when the record changed</p>
                      <ul className="mt-1 space-y-0.5">{run.recommendations.map((r) => <li key={r.id}>{r.title} <Badge tone={REC_TONE[r.status] ?? "slate"}>{REC_STATUS_LABEL[r.status] ?? r.status}</Badge></li>)}</ul>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}

        {pane === "audit" && canRecord ? (
          audits.length ? (
            <ol className="space-y-1.5 text-meta" data-testid="body-map-audit">
              {audits.map((a) => (
                <li key={a.id} className="flex gap-3 border-b border-[#f2f4f7] pb-1.5">
                  <span className="w-[130px] shrink-0 text-slate-500">{fmtDate(a.createdAt, true)}</span>
                  <span className="min-w-0 flex-1"><span className="font-medium text-[#101828]">{AUDIT_LABEL[a.action] ?? a.action}</span> · {who(a.actorId)}</span>
                </li>
              ))}
            </ol>
          ) : <Empty>No audit entries.</Empty>
        ) : null}
      </div>
    </div>
  );
}

function colour(c: string) {
  const m: Record<string, string> = { Bruising: "#7c3aed", "Cuts and scratches": "#ec4899", "Pressure sore": "#ea580c", "Skin tear": "#f472b6", Wound: "#f97316", Burn: "#eab308", Swelling: "#22c55e", Redness: "#0ea5e9", Rash: "#a855f7" };
  return m[c] ?? "#64748b";
}

function uniquePeople(m: Map<TaskKind, { id: string; name: string }[]>) {
  const seen = new Map<string, { id: string; name: string }>();
  for (const xs of m.values()) for (const p of xs) seen.set(p.id, p);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function LinkCard({ icon, title, href, children }: { icon: ReactNode; title: string; href: string; children: ReactNode }) {
  return (
    <div className="bm-link-card">
      <Link href={href} className="flex items-center gap-1.5 font-semibold text-[#101828] no-underline">{icon}{title}</Link>
      <p className="mt-0.5 text-slate-600">{children}</p>
    </div>
  );
}

function NoteForm({ o, back, canPhotos }: { o: Obs; back: string; canPhotos: boolean }) {
  return (
    <form action={noteBodyMapAction} className="bm-note" data-testid="body-map-note-form">
      <Hidden v={{ back, observationId: o.id }} />
      <label className="block">
        <span className="mb-1.5 flex items-center gap-2 text-lead font-semibold text-[#101828]"><ClipboardText size={18} className="text-[#5b2bb5]" aria-hidden />Add Note / Update</span>
        <textarea name="text" required minLength={3} maxLength={4000} rows={3} className="input" placeholder="e.g. Reviewed today. Bruising appears smaller and the service user reports no discomfort. Continue monitoring according to the care plan." />
      </label>
      <p className="mt-1 text-caption text-slate-500">The date, time and your name are added when you save. The original observation and earlier notes are never changed.</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        {canPhotos ? <PhotoButton name="photo" accept={PHOTO_ACCEPT} maxBytes={MAX_DOCUMENT_BYTES} /> : <span />}
        <div className="flex gap-2"><button type="reset" className="bm-secondary">Cancel</button><button className="bm-primary">Save Note</button></div>
      </div>
    </form>
  );
}

function IncidentDecision({ o, back, incidents }: { o: Obs; back: string; incidents: Awaited<ReturnType<typeof linkableIncidents>> }) {
  return (
    <details className="mt-2" open={!o.incidentDecision ? true : undefined}>
      <summary className="cursor-pointer text-meta font-medium text-[#5b2bb5]">{o.incidentDecision ? "Change the decision" : "Decide whether an incident report is needed"}</summary>
      <div className="mt-2 space-y-2">
        <form action={bodyMapIncidentAction} className="bm-block space-y-2">
          <Hidden v={{ back, observationId: o.id, version: o.version, decision: "NEW" }} />
          <p className="font-medium">Report a new incident from this observation</p>
          <div className="grid grid-cols-2 gap-2">
            <label><span className="bm-label">Category</span><select name="category" defaultValue="Injury" className="input">{INCIDENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label><span className="bm-label">Severity</span><select name="severity" defaultValue="LOW" className="input"><option value="LOW">Low</option><option value="MODERATE">Moderate</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
          </div>
          <label className="block"><span className="bm-label">What happened</span><textarea name="description" required minLength={20} rows={3} className="input" defaultValue={`Body map: ${o.category.toLowerCase()} observed on ${o.region.toLowerCase()}. ${o.description}`} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" name="safeguarding" className="h-4 w-4" /> This is a safeguarding concern</label>
          <button className="bm-secondary bm-small">Report and link incident</button>
        </form>
        {incidents.length ? (
          <form action={bodyMapIncidentAction} className="bm-block space-y-2">
            <Hidden v={{ back, observationId: o.id, version: o.version, decision: "LINK" }} />
            <label className="block"><span className="bm-label">Link to an existing incident about this person</span><select name="incidentId" required className="input" defaultValue=""><option value="">Choose…</option>{incidents.map((i) => <option key={i.id} value={i.id}>{i.reference} · {i.category} · {fmtDate(i.occurredAt)}</option>)}</select></label>
            <label className="block"><span className="bm-label">Note (optional)</span><input name="note" maxLength={1000} className="input" /></label>
            <button className="bm-secondary bm-small">Link incident</button>
          </form>
        ) : null}
        <form action={bodyMapIncidentAction} className="bm-block space-y-2">
          <Hidden v={{ back, observationId: o.id, version: o.version, decision: "NOT_REQUIRED" }} />
          <label className="block"><span className="bm-label">No incident report needed, because</span><input name="note" required minLength={5} maxLength={1000} className="input" placeholder="e.g. Known cause, recorded in care plan" /></label>
          <button className="bm-secondary bm-small">Record decision</button>
        </form>
      </div>
    </details>
  );
}

/** Earliest and latest photographs of the same body area, side by side, for a person to compare. */
function PhotoCompare({ items, current, here }: { items: Obs[]; current: string; here: string }) {
  const withPhotos = items.flatMap((o) => o.photos.map((p) => ({ o, p })));
  if (withPhotos.length < 2) return null;
  const first = withPhotos[0]!;
  const last = withPhotos[withPhotos.length - 1]!;
  return (
    <div className="bm-block" data-testid="body-map-photo-compare">
      <p className="bm-h4">Side by side: {first.o.region}</p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {[["Earliest", first], ["Latest", last]].map(([label, x]) => {
          const it = x as typeof first;
          return (
            <figure key={label as string} className={`text-caption ${it.o.id === current ? "" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl(it.p.id)} alt={`${label} photo, ${fmtDate(it.p.uploadedAt)}`} className="h-32 w-full rounded-[8px] border border-[#eaecf0] object-cover" />
              <figcaption className="mt-1 text-slate-600">{label as string}: {fmtDate(it.p.uploadedAt, true)} · <Link href={`${here}&obs=${it.o.id}&pane=photos`}>{it.o.category}</Link>{it.o.size ? ` · recorded size ${it.o.size}` : ""}</figcaption>
            </figure>
          );
        })}
      </div>
      <p className="mt-1 text-caption text-slate-500">For a person to compare. The system does not assess photographs.</p>
    </div>
  );
}

type Runs = Awaited<ReturnType<typeof recommendationRuns>>;

function Timeline({ o, runs, who }: { o: Obs; runs: Runs; who: (id: string | null | undefined) => string }) {
  const items: { at: Date; title: string; detail?: string; by?: string }[] = [
    { at: o.recordedAt, title: "Observation recorded", detail: `${o.category} on ${o.region}${o.size ? `, ${o.size}` : ""}`, by: who(o.recordedById) },
    ...o.notes.map((n) => ({ at: n.createdAt, title: "Note", detail: n.text, by: who(n.authorId) })),
    ...o.reviews.map((r) => ({ at: r.reviewedAt, title: r.resolved ? "Follow-up: resolved" : "Follow-up", detail: r.outcome, by: who(r.reviewedById) })),
    ...o.photos.map((p) => ({ at: p.uploadedAt, title: "Photograph added", detail: p.caption ?? undefined, by: who(p.uploadedById) })),
    ...(o.incidentDecidedAt ? [{ at: o.incidentDecidedAt, title: o.incidentDecision === "LINKED" ? `Incident decision: linked${o.incident ? ` to ${o.incident.reference}` : ""}` : "Incident decision: not needed", detail: o.incidentDecisionNote ?? undefined, by: who(o.incidentDecidedById) }] : []),
    ...o.tasks.flatMap((t) => [{ at: t.createdAt, title: `Task created: ${TASK_KINDS[t.kind as TaskKind]?.label ?? t.kind}`, detail: `For ${who(t.assigneeId)}, due ${fmtDate(t.dueOn)}`, by: who(t.createdById) }, ...(t.closedAt ? [{ at: t.closedAt, title: t.status === "DONE" ? "Task completed" : "Task cancelled", detail: t.outcome ?? undefined, by: who(t.closedById) }] : [])]),
    ...runs.map((r) => ({ at: r.createdAt, title: r.status === "FAILED" ? "AI recommendations failed" : `AI recommendations: ${r.recommendations.length}${r.isSimulated ? " (simulated)" : ""}`, detail: r.error ?? undefined, by: r.trigger === "AUTO" ? "Automatic" : who(r.requestedById) })),
    ...runs.flatMap((r) => r.recommendations.filter((x) => x.decidedAt).map((x) => ({ at: x.decidedAt!, title: `Suggestion ${REC_STATUS_LABEL[x.status]?.toLowerCase()}`, detail: `${x.title}${x.decisionNote ? `: ${x.decisionNote}` : ""}`, by: who(x.decidedById) }))),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return (
    <ol className="relative space-y-3 border-l-2 border-[#e9d7fe] pl-4" data-testid="body-map-timeline">
      {items.map((it, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[22px] top-1 h-2.5 w-2.5 rounded-full bg-[#7f56d9] ring-2 ring-white" />
          <p className="font-medium text-[#101828]">{it.title}</p>
          {it.detail ? <p className="whitespace-pre-line text-meta text-slate-600">{it.detail}</p> : null}
          <p className="text-caption text-slate-500">{fmtDate(it.at, true)}{it.by ? ` · ${it.by}` : ""}</p>
        </li>
      ))}
    </ol>
  );
}
