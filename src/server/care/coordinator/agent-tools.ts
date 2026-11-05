import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { INTAKE_STATUS, SECTION_KEYS, sectionLabel, type IntakeSection } from "@/lib/care-coordinator-rules";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { memberScope, serviceUserWhere, type Scope } from "@/server/rota/scope";
import { suName, visitCandidates } from "@/server/rota/queries";
import { lookUpReferences, serviceUserMatchWhere } from "@/server/care/service-user-search";
import { fromDbDate, dbDate, isIsoDate, londonDate, londonTime, parseHhmm } from "@/lib/london";
import { visitWhere, rotaScope } from "@/server/rota/scope";
import { previewAdjustVisitTime, adjustVisitTime } from "@/server/rota/adjust-time";
import { getVisit } from "@/server/rota/visits";
import { assignCarer } from "@/server/rota/assign";
import { carerPlaces, openPlaces, parsePlace, placeLabel } from "@/lib/carer-places";
import { AiUnavailableError, type AgentToolSpec } from "@/server/ai/provider";
import { answerFromCrm, type CrmLink, type CrmPage } from "./crm-assistant";
import { serviceUserChatContext } from "./chat";
import { createIntake, getIntake, listIntakes, readIntakeDocument } from "./intake";
import { intakeDigest } from "./intake-digest";
import { rotaReadiness } from "./rota";

/**
 * The only things the AI CSB Coordinator model can do (owner's brief, 5 Nov 2026). Each tool is ordinary server code:
 * it validates its input with zod, runs with the signed-in employee's ctx, and goes through the same service functions
 * (and so the same organisation, branch, area and role checks) as the CRM screens.
 *
 *  - Read tools: search, a service user's non-clinical summary, an intake's extracted facts with their pages, drafts
 *    for one section, the review and approval steps, and the built-in CRM answers.
 *  - Write tools: start a draft care intake, and read documents already uploaded to an intake. Both are reversible
 *    drafts that a person reviews. There is deliberately no tool to approve, save to a record, publish, send, book or
 *    delete anything, and no tool that takes SQL, code, a URL or an organisation id.
 *  - Links returned to the employee only ever come from these tools, after the record was checked.
 *  - Results are data for the model. Text read from documents stays inside quoted JSON fields.
 */

export interface ToolState {
  links: CrmLink[];
  /** Records this turn changed, for the audit and the reply. */
  wrote: { tool: string; ref: string }[];
  /** Calls so far, by name, for the audit (never their inputs). */
  calls: { name: string; ok: boolean }[];
  page: CrmPage;
  /** Exact employee utterance, never model-authored. All rota writes must be requested here. */
  userQuestion?: string;
  /** Verified one-result lookups within this message; prevents a model choosing a guessed or ambiguous person. */
  confirmedServiceUserIds?: string[];
  /** Exactly one identified visit within this message (or the opened visit page). */
  identifiedVisitIds?: string[];
  /** Carers actually returned by a ranked eligibility query in this message. */
  offeredCarers?: { id: string; name: string; state: string }[];
}

interface Tool<S extends z.ZodTypeAny> {
  spec: AgentToolSpec;
  schema: S;
  run(ctx: Ctx, input: z.infer<S>, state: ToolState): Promise<unknown>;
}

const ID = /^[a-zA-Z0-9]{10,40}$/;
const id = z.string().regex(ID, "Not a record id");
const nullableString = (description: string) => ({ type: ["string", "null"], description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const can = (ctx: Ctx, p: Parameters<typeof hasOrgPermission>[1]) => hasOrgPermission(ctx, p);
const coordinatorRole = (ctx: Ctx) => can(ctx, "serviceUser.edit") && can(ctx, "rota.edit") && can(ctx, "serviceUser.documents");
const link = (state: ToolState, l: CrmLink) => {
  if (!state.links.some((x) => x.href === l.href)) state.links.push(l);
};
const intakeHref = (intakeId: string, step?: string) => `/rota/coordinator/${encodeURIComponent(intakeId)}${step ? `?step=${step}` : ""}`;

async function scopeOf(ctx: Ctx): Promise<Scope> {
  return { organisationId: ctx.organisationId!, ...(await memberScope(ctx.userId, ctx.organisationId!)) };
}

// ── Documents being read right now, so two chat messages (or two tabs) never pay for the same reading twice. ──
const reading = new Map<string, Promise<unknown>>();
export async function readOnce<T>(key: string, fn: () => Promise<T>): Promise<{ result: T; joined: boolean }> {
  const running = reading.get(key) as Promise<T> | undefined;
  if (running) return { result: await running, joined: true };
  const p = fn().finally(() => reading.delete(key));
  reading.set(key, p);
  return { result: await p, joined: false };
}

/** At most this many documents are read (chargeable with AI reading on) in one chat message. */
export const MAX_READS_PER_MESSAGE = 2;

const findVisitsSchema = z.object({
  serviceUserId: id,
  date: z.string().refine(isIsoDate, "Use a valid YYYY-MM-DD local date"),
  start: z.string().nullable().refine((v) => v === null || parseHhmm(v) !== null, "Use HH:mm or null"),
});
const adjustTimeSchema = z.object({
  visitId: id,
  lockVersion: z.number().int().nonnegative(),
  start: z.string().refine((v) => parseHhmm(v) !== null, "Use HH:mm"),
});
const rankedCarersSchema = z.object({ visitId: id });
const bookCarerSchema = z.object({ visitId: id, lockVersion: z.number().int().nonnegative(), slot: z.string(), staffId: id });

/** Confirm that the employee explicitly requested a rota change, not just a question about one. */
function requestedChange(state: ToolState, verbs: RegExp) {
  return Boolean(state.userQuestion && verbs.test(state.userQuestion));
}
function targetTimeMentioned(state: ToolState, target: string) {
  const times = (state.userQuestion ?? "").match(/\b\d{1,2}[:.]\d{2}\b/g) ?? [];
  return times.some((t) => parseHhmm(t.replace(".", ":")) === parseHhmm(target));
}
function canChangeIdentifiedVisit(state: ToolState, visitId: string) {
  return state.identifiedVisitIds?.includes(visitId) || (state.page.kind === "visit" && state.page.id === visitId);
}

const tools = {
  search_records: {
    spec: {
      name: "search_records",
      description: "Find service users and care intakes the employee may see. Full names such as Angus Abbott work; references, postcodes and Frameworki references use the CRM's normal search. If a surname appears misspelt, possibleServiceUsers is a SUGGESTION ONLY, never verified for changing visits.",
      inputSchema: obj({ query: { type: "string", description: "Name or reference, at least 2 characters" } }),
    },
    schema: z.object({ query: z.string().trim().min(2).max(60) }),
    async run(ctx, { query }, state) {
      const out: { serviceUsers: unknown[]; possibleServiceUsers: unknown[]; intakes: unknown[]; referenceProblem: string | null } = { serviceUsers: [], possibleServiceUsers: [], intakes: [], referenceProblem: null };
      if (can(ctx, "serviceUser.view")) {
        const scope = await scopeOf(ctx);
        const references = await lookUpReferences(ctx, query);
        out.referenceProblem = references.problem;
        const match = serviceUserMatchWhere(query, { sensitive: can(ctx, "serviceUser.sensitive"), referenceIds: references.hits.map((x) => x.serviceUserId) });
        const rows = await db.serviceUser.findMany({
          where: { AND: [serviceUserWhere(scope), match] },
          select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, csbReference: true, status: true },
          take: 9, orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        });
        out.serviceUsers = rows.slice(0, 8).map((person) => ({ id: person.id, name: suName(person), reference: person.csbReference ?? person.reference, status: person.status.toLowerCase() }));
        // A unique result is a clear identity. Multiple matches must be disambiguated by reference.
        if (rows.length === 1) state.confirmedServiceUserIds = [...new Set([...(state.confirmedServiceUserIds ?? []), rows[0]!.id])];
        for (const person of rows.slice(0, 3)) link(state, { label: suName(person) + " · " + (person.csbReference ?? person.reference), href: "/rota/service-users/" + person.id });
        // Never auto-select a partial first-name fallback: only show possible candidates for human confirmation.
        if (!rows.length && query.trim().includes(" ")) {
          const given = query.trim().split(/\s+/)[0]!;
          if (/^[a-z]{3,}$/i.test(given)) {
            const options = await db.serviceUser.findMany({
              where: { AND: [serviceUserWhere(scope), { OR: [{ firstName: { contains: given, mode: "insensitive" } }, { preferredName: { contains: given, mode: "insensitive" } }] }] },
              select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, csbReference: true },
              take: 6,
            });
            out.possibleServiceUsers = options.map((person) => ({ id: person.id, name: suName(person), reference: person.csbReference ?? person.reference, verified: false }));
          }
        }
      }
      if (coordinatorRole(ctx)) {
        const q = query.toLowerCase();
        const rows = (await listIntakes(ctx)).filter((r) => r.reference.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || (r.person?.name.toLowerCase().includes(q) ?? false)).slice(0, 8);
        out.intakes = rows.map((r) => ({ id: r.id, reference: r.reference, title: r.title, status: INTAKE_STATUS[r.status as keyof typeof INTAKE_STATUS] ?? r.status, person: r.person?.name ?? null, openFacts: r.openFacts }));
      }
      return out;
    },
  } satisfies Tool<z.ZodObject<{ query: z.ZodString }>>,

  list_open_intakes: {
    spec: { name: "list_open_intakes", description: "List care intakes that are not completed or cancelled, newest first, with their status and how many facts still need a decision.", inputSchema: obj({}) },
    schema: z.object({}),
    async run(ctx, _input, state) {
      if (!coordinatorRole(ctx)) throw new ForbiddenError("This employee's role cannot run care intakes.");
      const rows = (await listIntakes(ctx)).filter((r) => !["COMPLETED", "CANCELLED"].includes(r.status)).slice(0, 12);
      link(state, { label: "Care Coordinator", href: "/rota/coordinator" });
      return rows.map((r) => ({ id: r.id, reference: r.reference, title: r.title, status: INTAKE_STATUS[r.status as keyof typeof INTAKE_STATUS] ?? r.status, person: r.person?.name ?? null, openFacts: r.openFacts, updated: r.updatedAt.toISOString().slice(0, 10) }));
    },
  } satisfies Tool<z.ZodObject<Record<string, never>>>,

  get_service_user: {
    spec: { name: "get_service_user", description: "A non-clinical summary of one service user the employee may see: status, care plan versions and review dates, active risk assessments, active care package hours and the next 7 days' visits needing a carer.", inputSchema: obj({ serviceUserId: { type: "string" } }) },
    schema: z.object({ serviceUserId: id }),
    async run(ctx, { serviceUserId }, state) {
      const su = await serviceUserChatContext(ctx, serviceUserId);
      if (!su) throw new NotFoundError("Service user");
      link(state, { label: "Open service user", href: `/rota/service-users/${serviceUserId}` });
      return su;
    },
  } satisfies Tool<z.ZodObject<{ serviceUserId: typeof id }>>,

  get_intake: {
    spec: {
      name: "get_intake",
      description: "Everything extracted so far for one care intake, from the saved intake only: documents and read status, person/contact/reference facts, the nine care plan sections (with gaps), risk drafts, care package facts, recurring visits with funding, weekly minutes against the authorised package, conflicts, flags and missing information. Every fact has its document, page and quote. Facts the employee may not see are counted, never shown.",
      inputSchema: obj({ intakeId: { type: "string" } }),
    },
    schema: z.object({ intakeId: id }),
    async run(ctx, { intakeId }, state) {
      const view = await getIntake(ctx, intakeId);
      link(state, { label: `Review ${view.intake.reference}`, href: intakeHref(intakeId) });
      return intakeDigest(view);
    },
  } satisfies Tool<z.ZodObject<{ intakeId: typeof id }>>,

  get_section_drafts: {
    spec: {
      name: "get_section_drafts",
      description: "The prepared drafts for one section of an intake, fact by fact, with value, the coordinator's decision, document, page and quote. Sections: PERSONAL, CONTACTS, CARER_PREFERENCES, PACKAGE, CARE_PLAN, RISKS, MEDICATION, INCIDENTS, BODY_MAP, VISITS, CALL_NOTES. Restricted sections need a manager's access.",
      inputSchema: obj({ intakeId: { type: "string" }, section: { type: "string", enum: [...SECTION_KEYS] } }),
    },
    schema: z.object({ intakeId: id, section: z.enum(SECTION_KEYS) }),
    async run(ctx, { intakeId, section }, state) {
      const view = await getIntake(ctx, intakeId);
      const docs = new Map(view.documents.map((d) => [d.id, d.name]));
      const facts = view.facts.filter((f) => f.section === section);
      link(state, { label: `${sectionLabel(section)} drafts`, href: intakeHref(intakeId, "facts") });
      return {
        section: sectionLabel(section as IntakeSection),
        hiddenFromThisEmployee: facts.filter((f) => f.hidden).length,
        facts: facts.filter((f) => !f.hidden).slice(0, 40).map((f) => ({
          label: f.label, value: f.display.slice(0, 1500), decision: f.decisionLabel, origin: f.origin === "AI" ? "read by AI" : f.origin === "BASIC" ? "read by CSB's own reader" : "added by a person",
          historical: f.temporal === "HISTORICAL", conflict: f.conflict, existingOnRecord: f.existing, question: f.question,
          source: { document: f.sourceDocumentId ? (docs.get(f.sourceDocumentId) ?? null) : null, page: f.sourcePage, quote: f.quote?.slice(0, 300) ?? null, checkedAgainstPage: f.verification === "VERIFIED" },
        })),
      };
    },
  } satisfies Tool<z.ZodObject<{ intakeId: typeof id; section: z.ZodEnum<typeof SECTION_KEYS> }>>,

  get_review_steps: {
    spec: { name: "get_review_steps", description: "What still has to happen on an intake before anything reaches the person's record or the rota: open facts, manager approval per section, save to record, follow-ups and the rota readiness checks (care package, visits, care plan approved by a different person, risks reviewed).", inputSchema: obj({ intakeId: { type: "string" } }) },
    schema: z.object({ intakeId: id }),
    async run(ctx, { intakeId }, state) {
      const view = await getIntake(ctx, intakeId);
      const status = view.intake.status as keyof typeof INTAKE_STATUS;
      const open = view.sections.reduce((n, s) => n + s.open, 0);
      const unread = view.documents.filter((d) => d.readStatus === "PENDING" || d.readStatus === "FAILED").length;
      const ready = view.intake.serviceUserId ? await rotaReadiness(ctx, intakeId).catch(() => null) : null;
      const next =
        status === "DRAFT"
          ? !view.documents.length ? "Upload the support plan." : unread ? `${unread} document(s) still to read.` : open ? `${open} fact(s) still need the coordinator's check, then submit to a manager.` : "Submit the intake to a manager."
          : status === "SUBMITTED" ? "A manager approves each section. The person who submitted it cannot approve it."
          : status === "APPROVED" ? "A person presses Save to record for the approved sections."
          : status === "APPLYING" ? "Saving is in progress; check any section that failed."
          : "The intake is closed.";
      link(state, { label: `Open ${view.intake.reference}`, href: intakeHref(intakeId, status === "DRAFT" ? "facts" : status === "SUBMITTED" ? "approval" : undefined) });
      if (ready?.serviceUser) link(state, { label: "Rota and carers step", href: intakeHref(intakeId, "rota") });
      return {
        status: INTAKE_STATUS[status] ?? status, nextStep: next, openFacts: open, unreadDocuments: unread,
        sections: view.sections.filter((s) => s.total > 0).map((s) => ({ section: sectionLabel(s.key), open: s.open, managerDecision: s.status, decidedBy: s.decidedBy, savedToRecord: s.applyStatus })),
        followUpsOpen: view.followUps.filter((f) => f.status !== "RESOLVED").map((f) => ({ category: f.category, text: f.description.slice(0, 300) })),
        rotaReadiness: ready ? { ready: ready.ready, gates: ready.gates.map((g) => ({ check: g.label, ok: g.ok, detail: g.detail })) } : "Not yet: the person is created when the Personal details section is approved and saved.",
        approvalsRecorded: view.sections.filter((s) => s.status === "APPROVED").map((s) => ({ section: sectionLabel(s.key), by: s.decidedBy })),
      };
    },
  } satisfies Tool<z.ZodObject<{ intakeId: typeof id }>>,

  create_intake: {
    spec: {
      name: "create_intake",
      description: "Start a new DRAFT care intake (nothing is added to any person's record). Only when the employee asked to start one and no suitable open intake exists. mode NEW sets up a new person; EXISTING updates the given service user. Returns the intake id; documents are attached by the employee with the paperclip.",
      inputSchema: obj({ title: { type: "string", description: "e.g. 'New referral, Stepney'" }, mode: { type: "string", enum: ["NEW", "EXISTING"] }, serviceUserId: nullableString("Required for EXISTING") }),
    },
    schema: z.object({ title: z.string().trim().min(3).max(120), mode: z.enum(["NEW", "EXISTING"]), serviceUserId: id.nullable() }),
    async run(ctx, input, state) {
      if (!coordinatorRole(ctx)) throw new ForbiddenError("This employee's role cannot start care intakes.");
      // A repeated message must not create a second intake: the same title by the same person in the last 10 minutes is reused.
      const recent = await db.careIntake.findFirst({ where: { organisationId: ctx.organisationId!, createdById: ctx.userId, title: input.title, status: "DRAFT", createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
      const intake = recent ?? (await createIntake(ctx, { title: input.title, mode: input.mode, serviceUserId: input.serviceUserId ?? undefined }));
      if (!recent) state.wrote.push({ tool: "create_intake", ref: `CareIntake:${intake.id}` });
      link(state, { label: `Open ${intake.reference}`, href: intakeHref(intake.id, "documents") });
      return { created: !recent, reusedExisting: !!recent, intakeId: intake.id, reference: intake.reference, status: "Coordinator review (draft)", next: "Attach the support plan with the paperclip, or upload it on the intake's Documents step." };
    },
  } satisfies Tool<z.ZodObject<{ title: z.ZodString; mode: z.ZodEnum<["NEW", "EXISTING"]>; serviceUserId: z.ZodNullable<typeof id> }>>,

  read_documents: {
    spec: {
      name: "read_documents",
      description: `Read the intake's uploaded PDFs that have not been read yet (at most ${MAX_READS_PER_MESSAGE} per message), using the organisation's approved reading pipeline. Documents already read are never read again here. Set retryFailed to true only when the employee asks to retry a failed reading. Afterwards call get_intake for the results.`,
      inputSchema: obj({ intakeId: { type: "string" }, retryFailed: { type: "boolean" } }),
    },
    schema: z.object({ intakeId: id, retryFailed: z.boolean() }),
    async run(ctx, { intakeId, retryFailed }, state) {
      const view = await getIntake(ctx, intakeId);
      if (view.intake.status !== "DRAFT") throw new ConflictError("Documents are only read while the coordinator is reviewing the intake.");
      const todo = view.documents.filter((d) => d.contentType === "application/pdf" && (d.readStatus === "PENDING" || (retryFailed && d.readStatus === "FAILED")));
      const results: { document: string; outcome: string }[] = [];
      for (const d of todo.slice(0, MAX_READS_PER_MESSAGE)) {
        try {
          const { joined } = await readOnce(`read:${d.id}`, () => readIntakeDocument(ctx, d.id));
          results.push({ document: d.name, outcome: joined ? "already being read by another request; used that reading" : "read" });
          state.wrote.push({ tool: "read_documents", ref: `CareIntakeDocument:${d.id}` });
        } catch (e) {
          results.push({ document: d.name, outcome: `could not be read: ${e instanceof AppError || e instanceof AiUnavailableError ? e.message.slice(0, 200) : "the reading failed; press Read again on the intake, or add the facts by hand"}` });
        }
      }
      link(state, { label: `Check facts in ${view.intake.reference}`, href: intakeHref(intakeId, "facts") });
      return {
        read: results,
        notReadNow: todo.length > MAX_READS_PER_MESSAGE ? todo.length - MAX_READS_PER_MESSAGE : 0,
        alreadyRead: view.documents.filter((d) => ["READ", "PARTLY_READ"].includes(d.readStatus)).length,
        notReadable: view.documents.filter((d) => d.readStatus === "UNREADABLE" || d.contentType !== "application/pdf").map((d) => d.name),
      };
    },
  } satisfies Tool<z.ZodObject<{ intakeId: typeof id; retryFailed: z.ZodBoolean }>>,

  find_visits: {
    spec: {
      name: "find_visits",
      description: "Find a named service user's scheduled visits on a specific local date, optionally at a specific start time. Returns visit IDs, reference, actual saved times, lockVersion and booked carers. Search for the person first. To change a visit, exactly one visit must be identified.",
      inputSchema: obj({ serviceUserId: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD UK local date" }, start: nullableString("HH:mm, or null for every visit on that date") }),
    },
    schema: findVisitsSchema,
    async run(ctx, { serviceUserId, date, start }, state) {
      const scope = await rotaScope(ctx, "rota.view");
      const person = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true } });
      if (!person) throw new NotFoundError("Service user");
      const visits = await db.visit.findMany({
        where: { ...visitWhere(scope), serviceUserId, date: dbDate(date), status: { not: "CANCELLED" } },
        select: { id: true, reference: true, scheduledStart: true, scheduledEnd: true, status: true, lockVersion: true, carersRequired: true, publishedAt: true, assignments: { where: { removedAt: null }, select: { slot: true, position: true, staff: { select: { displayName: true } } } } },
        orderBy: { scheduledStart: "asc" }, take: 40,
      });
      const found = start ? visits.filter((v) => parseHhmm(londonTime(v.scheduledStart)) === parseHhmm(start)) : visits;
      if (found.length === 1 && (state.confirmedServiceUserIds?.includes(serviceUserId) || (state.page.kind === "service-user" && state.page.id === serviceUserId) || (state.page.kind === "visit" && state.page.id === found[0]!.id))) {
        state.identifiedVisitIds = [...new Set([...(state.identifiedVisitIds ?? []), found[0]!.id])];
      }
      for (const v of found.slice(0, 3)) link(state, { label: v.reference + " · " + date + " " + londonTime(v.scheduledStart), href: "/rota/visits/" + v.id });
      return { person: suName(person), reference: person.reference, date, matched: found.length, visits: found.slice(0, 12).map((v) => ({
        visitId: v.id, reference: v.reference, lockVersion: v.lockVersion, time: londonTime(v.scheduledStart), durationMin: Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000), status: v.status, published: !!v.publishedAt,
        carersRequired: v.carersRequired, bookedCarers: v.assignments.map((a) => ({ name: a.staff.displayName, place: a.position })),
      })), ambiguous: found.length !== 1, instruction: found.length > 1 ? "Ask which visit using its exact time or reference before changing anything." : found.length === 0 ? "No matching visit; do not invent one." : undefined };
    },
  } satisfies Tool<typeof findVisitsSchema>,

  adjust_visit_time: {
    spec: {
      name: "adjust_visit_time",
      description: "Change ONLY one uniquely identified SCHEDULED visit's start time on its own day, retaining its existing duration and recurring template. Only if the employee explicitly requested this change. Previews and checks staff conflicts first; warnings require the employee to explicitly confirm them in the chat before changing anything. Never changes past, started or locked visits.",
      inputSchema: obj({ visitId: { type: "string" }, lockVersion: { type: "integer" }, start: { type: "string", description: "New HH:mm start time" } }),
    },
    schema: adjustTimeSchema,
    async run(ctx, { visitId, lockVersion, start }, state) {
      if (!can(ctx, "rota.edit")) throw new ForbiddenError("You don't have permission to edit the rota.");
      if (!canChangeIdentifiedVisit(state, visitId)) throw new ConflictError("Identify exactly one visit through find_visits first. No rota change was made.");
      if (!requestedChange(state, /\b(move|change|shift|adjust|reschedule|edit|confirm)\b/i) || !targetTimeMentioned(state, start)) throw new ConflictError("The employee must explicitly request this particular new time. No rota change was made.");
      const current = await getVisit(ctx, visitId);
      const durationMin = Math.round((current.scheduledEnd.getTime() - current.scheduledStart.getTime()) / 60000);
      const reason = "One-off time change explicitly requested in AI CSB Coordinator by " + ctx.userName;
      const input = { visitId, lockVersion, start, durationMin, reason };
      const preview = await previewAdjustVisitTime(ctx, input);
      if (preview.blocking.length) return { changed: false, blocked: preview.blocking, warnings: preview.warnings, preview };
      if (preview.warnings.length && !/\b(confirm|proceed)\b.*\b(warning|despite|anyway)\b/i.test(state.userQuestion ?? "")) {
        return { changed: false, needsConfirmation: true, warnings: preview.warnings, preview, next: "Explain the exact warnings and ask for an explicit confirmation including the visit reference and target time. Do not claim the visit moved." };
      }
      const done = await adjustVisitTime(ctx, input);
      state.wrote.push({ tool: "adjust_visit_time", ref: "Visit:" + visitId });
      link(state, { label: "Updated " + preview.reference, href: "/rota/visits/" + visitId });
      return { changed: true, reference: done.reference, from: done.from, to: done.to, carersToldInApp: done.carersTold, warnings: done.warnings, recurringTemplateUnchanged: true, familyNotAutomaticallyNotified: true };
    },
  } satisfies Tool<typeof adjustTimeSchema>,

  suggest_carers: {
    spec: {
      name: "suggest_carers",
      description: "Show the existing eligibility-checked, ranked carer options for a uniquely identified visit, including reasons and any warnings. Staff are NOT booked by this tool.",
      inputSchema: obj({ visitId: { type: "string" } }),
    },
    schema: rankedCarersSchema,
    async run(ctx, { visitId }, state) {
      if (!can(ctx, "rota.view")) throw new ForbiddenError("You can't see the rota.");
      const visit = await getVisit(ctx, visitId);
      const candidates = await visitCandidates(ctx, visit, "ANY");
      const offered = candidates.filter((c) => c.state !== "NOT_ELIGIBLE").slice(0, 10);
      state.offeredCarers = offered.map((c) => ({ id: c.id, name: c.name, state: c.state }));
      link(state, { label: "Visit Details and all carers", href: "/rota/visits/" + visitId });
      return { visitId, lockVersion: visit.lockVersion, slots: openPlaces(visit.carersRequired, visit.assignments.filter((a) => !a.removedAt)), carers: offered.map((c) => ({ staffId: c.id, name: c.name, status: c.state, matchScore: c.score, reasons: c.reasons, why: c.explain })) };
    },
  } satisfies Tool<typeof rankedCarersSchema>,

  book_carer: {
    spec: {
      name: "book_carer",
      description: "Book an explicitly requested, eligible carer into an EMPTY place on an identified visit using the CRM's existing conflict, scope, eligibility and audit checks. No warning overrides, no speculative bookings. To choose automatically the employee must say 'book best available' or 'book top match'; otherwise the employee must name the carer. Requires suggest_carers in this same message.",
      inputSchema: obj({ visitId: { type: "string" }, lockVersion: { type: "integer" }, slot: { type: "string", description: "PRIMARY, SECOND, C3 etc" }, staffId: { type: "string" } }),
    },
    schema: bookCarerSchema,
    async run(ctx, { visitId, lockVersion, slot, staffId }, state) {
      if (!can(ctx, "rota.edit")) throw new ForbiddenError("You don't have permission to book carers.");
      if (!canChangeIdentifiedVisit(state, visitId)) throw new ConflictError("Identify exactly one visit before booking a carer.");
      if (!requestedChange(state, /\b(book|assign|allocate|confirm)\b/i)) throw new ConflictError("The employee must explicitly ask you to book this visit.");
      const place = parsePlace(slot);
      if (!place || place === "SHADOW") throw new ConflictError("Specify an ordinary carer place.");
      const offered = state.offeredCarers?.find((c) => c.id === staffId);
      if (!offered || offered.state !== "ELIGIBLE") throw new ConflictError("This carer was not verified eligible by suggest_carers in this message.");
      const request = (state.userQuestion ?? "").toLowerCase();
      const requestedBest = /\b(book|assign|allocate)\b.{0,45}\b(best available|top match|best match)\b/.test(request);
      const firstEligible = state.offeredCarers?.find((c) => c.state === "ELIGIBLE");
      const named = request.includes(offered.name.toLowerCase());
      if (!named && !(requestedBest && firstEligible?.id === staffId)) throw new ConflictError("Ask the employee to name the selected carer or explicitly request the best available match.");
      const v = await getVisit(ctx, visitId);
      const empty = openPlaces(v.carersRequired, v.assignments.filter((a) => !a.removedAt));
      if (!empty.includes(place)) throw new ConflictError("This carer place is already filled. Use the regular replacement workflow instead.");
      await assignCarer(ctx, { visitId, slot: place, staffId, lockVersion, acceptWarnings: false }, "ai-coordinator");
      state.wrote.push({ tool: "book_carer", ref: "Visit:" + visitId });
      link(state, { label: "Booked visit", href: "/rota/visits/" + visitId });
      return { booked: true, visitId, carer: offered.name, place: placeLabel(place), verifiedEligible: true, notificationsNotConfirmed: true };
    },
  } satisfies Tool<typeof bookCarerSchema>,

  crm_lookup: {
    spec: {
      name: "crm_lookup",
      description: "The CRM's built-in answers, scoped to this employee: risk reviews due, care plans awaiting approval or missing, visits needing a carer, missed visits, who is unavailable today/tomorrow, why a carer cannot be booked (on a visit page), care package gaps (on a service user page), rota readiness, finding a policy. Pass the employee's question in plain words.",
      inputSchema: obj({ question: { type: "string" } }),
    },
    schema: z.object({ question: z.string().trim().min(2).max(300) }),
    async run(ctx, { question }, state) {
      const r = await answerFromCrm(ctx, question, state.page);
      for (const l of r.links) link(state, l);
      return { topic: r.topic, answer: r.answer };
    },
  } satisfies Tool<z.ZodObject<{ question: z.ZodString }>>,
};

export type ToolName = keyof typeof tools;
export const TOOL_NAMES = Object.keys(tools) as ToolName[];
export const TOOL_SPECS: AgentToolSpec[] = TOOL_NAMES.map((n) => tools[n].spec);
/** Tools that create or change a draft. Everything else only reads. */
export const WRITE_TOOLS = new Set<ToolName>(["create_intake", "read_documents", "adjust_visit_time", "book_carer"]);

/**
 * Runs one tool call for the model. Unknown tools and bad input are refused; errors the employee may see are returned
 * as the tool's error text, anything else as a generic failure (and nothing about it reaches the model).
 */
export async function executeTool(ctx: Ctx, state: ToolState, name: string, raw: unknown): Promise<{ content: string; isError: boolean }> {
  const tool = (tools as Record<string, Tool<z.ZodTypeAny>>)[name];
  if (!tool) {
    state.calls.push({ name: "unknown", ok: false });
    return { content: JSON.stringify({ error: `There is no tool called ${name.slice(0, 40)}.` }), isError: true };
  }
  const parsed = tool.schema.safeParse(raw);
  if (!parsed.success) {
    state.calls.push({ name, ok: false });
    return { content: JSON.stringify({ error: `Invalid input: ${parsed.error.issues[0]?.message ?? "check the fields"}` }), isError: true };
  }
  try {
    const out = await tool.run(ctx, parsed.data, state);
    state.calls.push({ name, ok: true });
    // Results are capped so one call can never flood the conversation.
    const text = JSON.stringify(out);
    return { content: text.length > 24_000 ? `${text.slice(0, 24_000)}…(cut: ask for one section at a time)` : text, isError: false };
  } catch (e) {
    state.calls.push({ name, ok: false });
    const msg = e instanceof NotFoundError ? "Not found, or not available to this employee." : e instanceof AppError ? e.message : "The CRM could not complete this just now.";
    return { content: JSON.stringify({ error: msg }), isError: true };
  }
}
