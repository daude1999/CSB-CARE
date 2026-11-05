import "server-only";
import { db } from "@/lib/db";
import { addDays, dbDate, fmtLondonDate, fromDbDate, londonDate } from "@/lib/london";
import { INTAKE_STATUS } from "@/lib/care-coordinator-rules";
import { hasOrgPermission, visiblePolicyWhere, type Ctx } from "@/server/auth/rbac";
import { memberScope, serviceUserWhere, staffDirectoryWhere, visitWhere, type Scope } from "@/server/rota/scope";
import { eligibilityFor } from "@/server/workforce/eligibility";
import { packageCoverage } from "@/server/care/packages";
import { suName } from "@/server/rota/queries";
import { carePlanRegister } from "@/server/care/care-plans";
import { listRisks } from "@/server/care/risks";
import { getIntake, listIntakes } from "@/server/care/coordinator/intake";
import { serviceUserChatContext } from "@/server/care/coordinator/chat";

/**
 * The AI CSB Coordinator's built-in CRM search, used when no AI provider is switched on. It needs no key and never
 * goes online: it recognises common office questions by their words and answers from the organisation's own records,
 * with the same permission, branch and area checks as the screens it links to. Anything it does not recognise gets a
 * plain list of what it can answer. It never writes.
 */

export interface CrmLink { label: string; href: string }
export interface CrmAnswer { topic: string; answer: string; links: CrmLink[] }

export interface CrmPage { kind: "intake" | "service-user" | "visit" | "rota" | "overview" | "other"; id: string | null }

const has = (q: string, ...words: (string | RegExp)[]) => words.some((w) => (typeof w === "string" ? q.includes(w) : w.test(q)));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (d: Date) => fmtLondonDate(fromDbDate(d), { day: "numeric", month: "short", year: "numeric" });

/** Which question this is, from its words. Order matters: the more specific topics are checked first. */
export function topicOf(question: string, page: CrmPage): string {
  const q = question.toLowerCase();
  if (has(q, "upload", "support plan", "discharge", "referral", "document", "attach")) return "upload";
  if (has(q, "next step", "finish", "intake", "approve this", "submit")) return page.kind === "intake" ? "intake" : "intakes";
  if (has(q, /why (?:can'?t|cannot|can not|isn'?t|is not|won'?t)\b/, /\b(not|n't) (?:be )?(?:allocated|assigned|booked|eligible)\b/)) return "why-not";
  if (has(q, "unavailable", "not available", "off sick", "sickness", "on holiday", "on leave", "absent", "absence", "who is off", "who's off")) return "unavailable";
  if (page.kind === "service-user" && has(q, /(missing|gap|incomplete|wrong).*(package)|package.*(missing|gap|incomplete|complete|wrong)/)) return "package-gaps";
  if (has(q, "risk")) return "risks";
  if (has(q, "ready for rota", "rota generation", /ready.*rota/, /package.*ready/)) return "rota-ready";
  if (has(q, "care plan", "careplan", /plan.*(missing|approv|review|draft)/)) return "care-plans";
  if (has(q, "unassigned", "cover", "no carer", "need a carer", "needs a carer", "uncovered")) return "unassigned";
  if (has(q, "missed", "late visit", "late call")) return "missed";
  if (has(q, "build", "prepare a rota", "make a rota", "create a rota", "rota")) return "rota-how";
  if (has(q, "policy", "policies", "procedure")) return "policy";
  if (has(q, "new service user", "create service user", "add service user", "set up a service user", "onboard")) return "new-su";
  if (has(q, /^(find|search|look up|lookup|who is|where is)\b/, "find ")) return "find";
  if (page.kind === "service-user" && has(q, "this person", "this service user", "missing", "summary", "tell me")) return "su-summary";
  return "help";
}

/** Words of a "find ..." question that are not the name being searched for. */
function searchTerm(question: string) {
  return question.toLowerCase().replace(/[?.!,]/g, " ").replace(/\b(find|search|for|look|up|lookup|who|where|is|the|a|service|user|users|person|client|please|can|you|me|show)\b/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export async function answerFromCrm(ctx: Ctx, question: string, page: CrmPage, now = new Date()): Promise<CrmAnswer> {
  const topic = topicOf(question, page);
  const organisationId = ctx.organisationId!;
  const scope: Scope = { organisationId, ...(await memberScope(ctx.userId, organisationId)) };
  const can = (p: Parameters<typeof hasOrgPermission>[1]) => hasOrgPermission(ctx, p);
  const today = londonDate(now);
  const suPage = page.kind === "service-user" && page.id ? page.id : null;
  const done = (answer: string, links: CrmLink[] = []): CrmAnswer => ({ topic, answer, links });
  const noAccess = done("Your role can't see those records, so I can't answer that. Ask a care manager.");

  switch (topic) {
    case "upload": {
      if (!(can("serviceUser.documents") && can("serviceUser.edit") && can("rota.edit"))) return noAccess;
      return done(
        "To process a council support plan, hospital discharge letter or referral:\n1. Open Care Coordinator and start an intake (new person, or an existing service user).\n2. Upload the documents (up to 12 per intake). The originals are kept unchanged. PDFs with typed text are read on CSB's own server; scanned pages, Word files and images are kept but their facts are added by hand.\n3. Check each fact against the page it came from, then submit to a manager.\n4. The manager approves each section, and the approved facts are saved to the person's record.\nNothing is saved or sent to carers without a person deciding.",
        [{ label: "Open Care Coordinator", href: page.kind === "intake" && page.id ? `/rota/coordinator/${page.id}` : "/rota/coordinator" }],
      );
    }
    case "intake": {
      if (!page.id) return done("Open the intake you're working on and ask again.", [{ label: "Care Coordinator", href: "/rota/coordinator" }]);
      const view = await getIntake(ctx, page.id);
      const status = view.intake.status as keyof typeof INTAKE_STATUS;
      const open = view.sections.reduce((n, s) => n + s.open, 0);
      const waiting = view.sections.filter((s) => s.total > 0 && s.status === "OPEN").length;
      const unread = view.documents.filter((d) => d.readStatus === "PENDING" || d.readStatus === "FAILED").length;
      const followUps = (view.followUps ?? []).filter((f) => f.status !== "RESOLVED").length;
      const next =
        status === "DRAFT"
          ? !view.documents.length ? "Upload the support plan and any other referral documents."
            : unread ? `Read ${plural(unread, "document")} that ${unread === 1 ? "hasn't" : "haven't"} been read yet.`
            : open ? `Check ${plural(open, "fact")} still waiting for a decision, then submit to a manager.`
            : "Every fact has a decision. Submit the intake to a manager."
          : status === "SUBMITTED" ? `A manager needs to approve ${plural(waiting, "section")}. The person who submitted it can't approve it.`
          : status === "APPROVED" ? "Save the approved sections to the person's record (Save to record step)."
          : status === "APPLYING" ? "Saving is in progress. Check the Save to record step for any section that failed."
          : "This intake is closed. Nothing more to do here.";
      return done(
        `Intake ${view.intake.reference} (${view.intake.title}) is at: ${INTAKE_STATUS[status] ?? status}.\n${plural(view.documents.length, "document")}, ${plural(open, "fact")} still open${followUps ? `, ${plural(followUps, "follow-up")} to close` : ""}.\n\nNext step: ${next}`,
        [{ label: "Open this intake", href: `/rota/coordinator/${view.intake.id}` }],
      );
    }
    case "intakes": {
      if (!(can("serviceUser.documents") && can("serviceUser.edit") && can("rota.edit"))) return noAccess;
      const rows = (await listIntakes(ctx)).filter((r) => !["COMPLETED", "CANCELLED"].includes(r.status));
      if (!rows.length) return done("There are no open care intakes.", [{ label: "Start an intake", href: "/rota/coordinator" }]);
      const lines = rows.slice(0, 6).map((r) => `• ${r.reference} ${r.title}: ${INTAKE_STATUS[r.status as keyof typeof INTAKE_STATUS] ?? r.status}${r.openFacts ? `, ${plural(r.openFacts, "open fact")}` : ""}`);
      return done(`${plural(rows.length, "care intake")} open:\n${lines.join("\n")}${rows.length > 6 ? `\n…and ${rows.length - 6} more.` : ""}\n\nOpen an intake and ask "what is the next step?" for its next action.`, [{ label: "Care Coordinator", href: "/rota/coordinator" }]);
    }
    case "risks": {
      if (!can("serviceUser.view")) return noAccess;
      const [overdue, soon] = await Promise.all([listRisks(ctx, { due: "overdue", serviceUserId: suPage ?? undefined }), listRisks(ctx, { due: "30", serviceUserId: suPage ?? undefined })]);
      const dueSoon = soon.filter((r) => fromDbDate(r.reviewDue) >= today);
      if (!overdue.length && !dueSoon.length) return done(suPage ? "This person's risk assessments are all in date for the next 30 days." : "No risk assessments are overdue or due for review in the next 30 days.", [{ label: "Risk assessments", href: "/rota/risks" }]);
      const line = (r: (typeof overdue)[number]) => `• ${suName(r.serviceUser)}: ${r.title} (${r.level.toLowerCase()} risk), review ${day(r.reviewDue)}`;
      return done(
        [overdue.length ? `${plural(overdue.length, "risk assessment")} overdue for review:\n${overdue.slice(0, 6).map(line).join("\n")}${overdue.length > 6 ? `\n…and ${overdue.length - 6} more.` : ""}` : "None are overdue.", dueSoon.length ? `\n${plural(dueSoon.length, "more", "more")} due in the next 30 days.` : ""].join(""),
        [{ label: "Overdue risk reviews", href: "/rota/risks?due=overdue" }, { label: "Due within 30 days", href: "/rota/risks?due=30" }],
      );
    }
    case "care-plans": {
      if (!can("serviceUser.view")) return noAccess;
      if (suPage) {
        const su = await serviceUserChatContext(ctx, suPage);
        if (!su) return noAccess;
        const plans = su.carePlans as { version: number; status: string; reviewDue: string | null }[];
        const active = plans.find((p) => p.status === "ACTIVE");
        const pending = plans.find((p) => p.status !== "ACTIVE");
        const gaps = [!active ? "There is no approved care plan in use." : null, active?.reviewDue && active.reviewDue < today ? `The plan in use was due for review on ${fmtLondonDate(active.reviewDue)}.` : null, pending ? `Version ${pending.version} is ${pending.status === "IN_REVIEW" ? "waiting for approval by a second person" : "a draft still being written"}.` : null].filter(Boolean);
        return done(`${(su.serviceUser as { name: string }).name}: ${active ? `care plan version ${active.version} is in use${active.reviewDue ? `, review due ${fmtLondonDate(active.reviewDue)}` : ""}.` : "no care plan in use."}${gaps.length ? `\n\n${gaps.join("\n")}` : "\n\nNothing is missing from the plan's status. Check the sections themselves on the care plan page."}`, [{ label: "Open their care plans", href: `/rota/care-plans/${suPage}` }]);
      }
      const { totals } = await carePlanRegister(ctx, {});
      return done(
        `Across the people you can see:\n• ${plural(totals.none, "person", "people")} with no care plan in use\n• ${plural(totals.review, "plan")} awaiting approval\n• ${plural(totals.overdue, "plan")} overdue for review\n• ${plural(totals.draft, "draft")} still open`,
        [{ label: "Awaiting approval", href: "/rota/care-plans?show=review" }, { label: "No plan in use", href: "/rota/care-plans?show=none" }, { label: "Review overdue", href: "/rota/care-plans?show=overdue" }],
      );
    }
    case "unassigned": {
      if (!can("rota.view")) return noAccess;
      const rows = await db.visit.findMany({
        where: { ...visitWhere(scope), date: { gte: dbDate(today), lte: dbDate(addDays(today, 6)) }, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, ...(suPage ? { serviceUserId: suPage } : {}) },
        select: { date: true, carersRequired: true, assignments: { where: { removedAt: null, slot: { not: "SHADOW" } }, select: { id: true } } },
      });
      const open = rows.filter((v) => v.assignments.length < v.carersRequired);
      const todayCount = open.filter((v) => fromDbDate(v.date) === today).length;
      if (has(question.toLowerCase(), "tomorrow")) {
        const tomorrow = addDays(today, 1);
        const t = open.filter((v) => fromDbDate(v.date) === tomorrow).length;
        return done(t ? `${plural(t, "visit")} tomorrow (${fmtLondonDate(tomorrow)}) still need a carer. Use Find cover to see carers who are eligible and free.` : `Every visit tomorrow (${fmtLondonDate(tomorrow)}) has its carers.`, [{ label: "Unassigned visits", href: "/rota/unassigned" }, { label: "Tomorrow's Daily Rota", href: `/rota/visits?date=${tomorrow}` }]);
      }
      return done(open.length ? `${plural(open.length, "visit")} in the next 7 days still need a carer, ${todayCount} of them today. Use Find cover to see carers who are eligible and free. Every assignment goes through the eligibility checks.` : "Every visit in the next 7 days has its carers.", [{ label: "Unassigned visits", href: "/rota/unassigned" }, { label: "Sickness & holiday cover", href: "/rota/cover" }]);
    }
    case "missed": {
      if (!can("rota.monitor")) return noAccess;
      const missed = await db.visit.count({ where: { ...visitWhere(scope), date: dbDate(today), status: "MISSED" } });
      return done(missed ? `${plural(missed, "visit")} confirmed as missed today. Each one needs an investigation in Missed Calls.` : "No visits have been confirmed as missed today.", [{ label: "Missed Calls", href: "/rota/missed" }, { label: "The Monitor", href: "/rota/monitor" }]);
    }
    case "rota-ready": {
      if (!can("serviceUser.view")) return noAccess;
      if (!suPage) return done("Open the service user's page and ask again. I'll then check their package, care plan, templates and upcoming visits.", [{ label: "Service users", href: "/rota/service-users" }]);
      const su = await serviceUserChatContext(ctx, suPage);
      if (!su) return noAccess;
      const templates = await db.visitTemplate.count({ where: { organisationId, serviceUserId: suPage, OR: [{ effectiveTo: null }, { effectiveTo: { gte: dbDate(today) } }] } });
      const packages = su.activePackages as unknown[];
      const plans = su.carePlans as { status: string }[];
      const visits = su.nextSevenDaysVisits as { total: number; needingACarer: number } | string;
      const checks = [
        [packages.length > 0, packages.length ? "An active care package is recorded." : "No active care package is recorded."],
        [plans.some((p) => p.status === "ACTIVE"), plans.some((p) => p.status === "ACTIVE") ? "An approved care plan is in use." : "No approved care plan is in use."],
        [templates > 0, templates ? `${plural(templates, "current visit template")} set up.` : "No visit templates are set up yet."],
      ] as const;
      const ready = checks.every(([ok]) => ok);
      return done(`${(su.serviceUser as { name: string }).name}: ${ready ? "ready to build the rota." : "not ready for rota generation yet."}\n${checks.map(([ok, t]) => `${ok ? "✓" : "✗"} ${t}`).join("\n")}${typeof visits === "object" ? `\nNext 7 days: ${plural(visits.total, "visit")}, ${visits.needingACarer} still needing a carer.` : ""}`, [{ label: "Their rota", href: `/rota/service-users/${suPage}?tab=rota` }, { label: "Their templates", href: `/rota/service-users/${suPage}?tab=template` }]);
    }
    case "rota-how": {
      if (!can("rota.view")) return noAccess;
      return done(
        "To prepare a rota:\n1. Check the person has an approved care plan and an active care package.\n2. Set up their visit templates (days, times, duration, carers needed).\n3. Use Build Rota to create the weeks from the templates. Visits start unassigned and unpublished.\n4. Assign carers. Each assignment goes through the eligibility checks.\n5. Publish to carers when the week is right.",
        [...(can("rota.build") ? [{ label: "Build Rota", href: "/rota/build" }] : []), { label: "Daily Templates", href: "/rota/templates" }, ...(suPage ? [{ label: "This person's rota", href: `/rota/service-users/${suPage}?tab=rota` }] : [])],
      );
    }
    case "new-su": {
      if (!can("serviceUser.edit")) return noAccess;
      return done("You can set up a new service user by hand, or from their support plan. Using the support plan reads the facts for you, and a manager approves them.", [{ label: "Add service user", href: "/rota/service-users/new" }, ...(can("serviceUser.documents") ? [{ label: "Set up from a support plan", href: "/rota/coordinator" }] : [])]);
    }
    case "policy": {
      const term = question.toLowerCase().replace(/[?.!,]/g, " ").replace(/\b(what|is|our|the|a|on|for|about|policy|policies|procedure|do|we|have|find|show|me)\b/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!can("policy.read")) return noAccess;
      const rows = term.length >= 3 ? await db.policy.findMany({ where: { AND: [visiblePolicyWhere(ctx), { title: { contains: term, mode: "insensitive" } }] }, select: { id: true, title: true, status: true }, take: 6, orderBy: { title: "asc" } }) : [];
      return rows.length ? done(`Policies matching "${term}":\n${rows.map((p) => `• ${p.title}`).join("\n")}`, rows.map((p) => ({ label: p.title, href: `/policies/${p.id}` }))) : done(term.length >= 3 ? `No policy title matches "${term}". Try the Policy Library search.` : "Which policy? For example: \"safeguarding policy\".", [{ label: "Policy Library", href: `/policies${term.length >= 3 ? `?q=${encodeURIComponent(term)}` : ""}` }]);
    }
    case "find": {
      if (!can("serviceUser.view")) return noAccess;
      const term = searchTerm(question);
      if (term.length < 2) return done("Who are you looking for? For example: \"find Smith\".");
      const like = { contains: term, mode: "insensitive" as const };
      const rows = await db.serviceUser.findMany({ where: { AND: [serviceUserWhere(scope), { OR: [{ firstName: like }, { lastName: like }, { preferredName: like }, { reference: like }, { csbReference: like }] }] }, select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, status: true }, take: 6, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
      return rows.length ? done(`Service users matching "${term}":`, rows.map((s) => ({ label: `${suName(s)} · ${s.reference} · ${s.status.toLowerCase()}`, href: `/rota/service-users/${s.id}` }))) : done(`No service user you can see matches "${term}".`, [{ label: "Search rostering", href: `/rota/search?q=${encodeURIComponent(term)}` }]);
    }
    case "su-summary": {
      const su = await serviceUserChatContext(ctx, suPage!);
      if (!su) return noAccess;
      const p = su.serviceUser as { name: string; reference: string; status: string };
      const plans = su.carePlans as { status: string }[];
      const risks = su.riskAssessments as { overdue: boolean }[];
      const visits = su.nextSevenDaysVisits as { total: number; needingACarer: number } | string;
      return done(`${p.name} (${p.reference}) is ${p.status.toLowerCase()}.\n• Care plan: ${plans.some((x) => x.status === "ACTIVE") ? "approved plan in use" : "no approved plan in use"}\n• Risk assessments: ${risks.length} active, ${risks.filter((r) => r.overdue).length} overdue for review\n• Care package: ${(su.activePackages as unknown[]).length ? "active" : "none active"}${typeof visits === "object" ? `\n• Next 7 days: ${plural(visits.total, "visit")}, ${visits.needingACarer} needing a carer` : ""}`, [{ label: "Care plans", href: `/rota/care-plans/${suPage}` }, { label: "Risk assessments", href: `/rota/risks?su=${suPage}` }]);
    }
    case "unavailable": {
      if (!can("rota.view")) return noAccess;
      const day0 = has(question.toLowerCase(), "tomorrow") ? addDays(today, 1) : today;
      const from = new Date(`${day0}T00:00:00Z`);
      const to = new Date(`${addDays(day0, 1)}T00:00:00Z`);
      const rows = await db.staffAbsence.findMany({
        where: { organisationId, status: { in: ["APPROVED", "REQUESTED"] }, startsAt: { lt: to }, endsAt: { gt: from }, staff: staffDirectoryWhere(scope, {}) },
        select: { kind: true, status: true, endsAt: true, staff: { select: { displayName: true, jobTitle: true } } },
        orderBy: { startsAt: "asc" }, take: 50,
      });
      const when = day0 === today ? "today" : "tomorrow";
      if (!rows.length) return done(`No staff absence is recorded for ${when} (${fmtLondonDate(day0)}). Absences come from HR & Workforce; weekly availability is on each staff page.`, [{ label: "Staff absences", href: "/workforce/absences" }]);
      const line = (r: (typeof rows)[number]) => `• ${r.staff.displayName} (${r.staff.jobTitle}): ${r.kind.toLowerCase()}${r.status === "REQUESTED" ? " (requested, not yet approved)" : ""}, last day ${fmtLondonDate(londonDate(new Date(r.endsAt.getTime() - 1)))}`;
      return done(`${plural(rows.length, "member of staff", "members of staff")} with an absence recorded for ${when}:\n${rows.slice(0, 10).map(line).join("\n")}${rows.length > 10 ? `\n…and ${rows.length - 10} more.` : ""}\n\nVisits already booked with them are flagged on the rota; nobody is moved automatically.`, [{ label: "Staff absences", href: "/workforce/absences" }, { label: "Sickness & holiday cover", href: "/rota/cover" }]);
    }
    case "why-not": {
      if (!can("rota.view")) return noAccess;
      if (page.kind !== "visit" || !page.id) return done("Open the visit on the Daily Rota and ask again, for example \"why can't Sam be booked?\". The allocation picker on the visit also shows each carer's reasons.", [{ label: "Daily Rota", href: "/rota/visits" }]);
      const visit = await db.visit.findFirst({ where: { ...visitWhere(scope), id: page.id }, select: { id: true, scheduledStart: true, scheduledEnd: true, serviceUserId: true, areaId: true, timeLocked: true, tasks: { select: { careTaskId: true } } } });
      if (!visit) return noAccess;
      const term = question.toLowerCase().replace(/[?.!,']/g, " ").replace(/\b(why|can|cant|cannot|not|be|is|isnt|won|wont|t|allocated|assigned|booked|book|allocate|assign|eligible|to|this|visit|carer|staff|the|on|for|i)\b/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
      if (term.length < 2) return done("Which carer? For example: \"why can't Sam be booked?\"");
      const staff = await db.staffMember.findMany({ where: staffDirectoryWhere(scope, { q: term }), select: { id: true, displayName: true }, take: 3, orderBy: { displayName: "asc" } });
      if (!staff.length) return done(`No carer you can see matches "${term}".`, [{ label: "Open this visit", href: `/rota/visits/${visit.id}` }]);
      if (staff.length > 1) return done(`More than one carer matches "${term}": ${staff.map((x) => x.displayName).join(", ")}. Use more of the name.`);
      const who = staff[0]!;
      const r = await eligibilityFor(db, organisationId, { staffId: who.id, start: visit.scheduledStart, end: visit.scheduledEnd, visitId: visit.id, serviceUserId: visit.serviceUserId, areaId: visit.areaId, timeLocked: visit.timeLocked, careTaskIds: visit.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x) });
      const lines = [...r.blocking.map((b) => `✗ ${b.message}`), ...r.warnings.map((w) => `! ${w.message}`), ...r.advice.map((a) => `• ${a.message}`)];
      const verdict = r.blocking.length ? "cannot be booked on this visit" : r.warnings.length ? "can be booked only if you accept the warnings" : "can be booked on this visit";
      return done(`${who.displayName} ${verdict}. These are the same checks the allocation picker uses.${lines.length ? `\n${lines.join("\n")}` : ""}\n\nI don't book anyone. Use the visit page to allocate.`, [{ label: "Open this visit", href: `/rota/visits/${visit.id}` }]);
    }
    case "package-gaps": {
      if (!can("serviceUser.view") || !suPage) return noAccess;
      const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: suPage }, select: { id: true, firstName: true, lastName: true, preferredName: true } });
      if (!su) return noAccess;
      const pkg = await db.carePackage.findFirst({ where: { organisationId, serviceUserId: su.id, status: "ACTIVE" }, orderBy: { startDate: "desc" } });
      const link = [{ label: "Care package", href: `/rota/service-users/${su.id}?tab=package` }];
      if (!pkg) return done(`${suName(su)} has no active care package. Record one from the Care package tab before building a rota.`, link);
      const cov = await packageCoverage(organisationId, su.id);
      const gaps = [
        pkg.commissionedMinutesPerWeek === null ? "No commissioned weekly hours are recorded." : null,
        !pkg.funderId ? "No funder is linked (finance links the funder)." : null,
        !pkg.reference ? "No package or purchase order reference." : null,
        !pkg.requirements ? "No staffing requirements written." : null,
        !pkg.endDate ? "No end date (fine for an ongoing package; check with the commissioner if it is temporary)." : null,
        !cov.templates ? "No current visit templates." : cov.difference ? `Visit templates plan ${cov.planned} minutes a week but ${cov.commissioned} are commissioned (${Math.abs(cov.difference)} ${cov.difference > 0 ? "over" : "short"}). A manager settles this with the commissioner; nothing is changed automatically.` : null,
      ].filter(Boolean);
      return done(`${suName(su)}'s active care package (from ${fmtLondonDate(fromDbDate(pkg.startDate))}):${gaps.length ? `\n${gaps.map((g) => `• ${g}`).join("\n")}` : "\nNothing obvious is missing, and the visit templates match the commissioned hours."}\nVisit templates plan ${cov.planned} visit minutes and ${cov.plannedCarerMinutes} carer minutes a week.`, link);
    }
    default:
      return done(
        "I answer from your CRM records only. Try asking:\n• \"Which risk assessments still need reviewing?\"\n• \"Which care plans are awaiting approval?\"\n• \"How many visits need a carer?\"\n• \"What is the next step to finish this intake?\" (on an intake page)\n• \"Is this care package ready for rota generation?\" (on a service user's page)\n• \"Who is unavailable tomorrow?\" or \"Which visits are unassigned tomorrow?\"\n• \"Why can't Sam be booked?\" (on a visit's page)\n• \"What is missing from this care package?\" (on a service user's page)\n• \"Find Smith\" or \"safeguarding policy\"",
      );
  }
}
