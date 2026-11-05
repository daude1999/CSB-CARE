import "server-only";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { findFrameworki, classifyReferenceContext, FRAMEWORKI, TOWER_HAMLETS_COUNCIL, type ReferenceType } from "@/lib/reference-numbers";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";
import { memberNames } from "@/server/rota/queries";
import { categoryLabel } from "./su-documents";
import { referencesFor } from "./external-references";

/**
 * Everything the Service User → Reference Numbers tab shows, read from the existing records only: the permanent CSB
 * reference, the encrypted external reference register (with each row's source document resolved through the
 * normal document permissions), care package references, the NHS number reconciliation and the register's history.
 * Nothing here writes. Restricted values (NHS numbers, restricted documents) are removed before they reach the page.
 */

export type SourceDoc =
  | { kind: "document"; id: string; name: string; section: "COUNCIL" | "OTHER"; restricted: boolean }
  | { kind: "intake"; intakeId: string; name: string; restricted: boolean }
  | { kind: "missing" };

export type NhsCheck = "MATCH" | "DIFFERS" | "REGISTER_ONLY" | "PROFILE_ONLY" | "NONE" | "RESTRICTED";

const HISTORY_ACTIONS = ["serviceUser.externalReference.added", "serviceUser.externalReference.verified", "serviceUser.externalReference.superseded", "serviceUser.externalReference.reinstated"];

export async function referenceNumbersTab(ctx: Ctx, serviceUserId: string) {
  const reg = await referencesFor(ctx, serviceUserId);
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await db.serviceUser.findFirst({
    where: { ...serviceUserWhere(scope), id: serviceUserId },
    select: { id: true, organisationId: true, nhsNumber: true, carePreferences: true, accessNotes: true, communicationNeeds: true, packages: { orderBy: { startDate: "desc" }, select: { id: true, reference: true, status: true, startDate: true, endDate: true, requirements: true } } },
  });
  if (!su) throw new NotFoundError("Service user");
  const sensitive = hasOrgPermission(ctx, "serviceUser.sensitive");
  const canEdit = hasOrgPermission(ctx, "serviceUser.edit");

  // Source documents: a person's own document, or an intake document (shown as its filed copy once filed).
  const docIds = [...new Set(reg.rows.map((r) => r.sourceDocumentId).filter((x): x is string => !!x))];
  const intakeDocs = docIds.length ? await db.careIntakeDocument.findMany({ where: { id: { in: docIds }, organisationId: su.organisationId, intake: { serviceUserId: su.id } }, select: { id: true, name: true, sensitive: true, intakeId: true, filedDocumentId: true } }) : [];
  const allDocIds = [...docIds, ...intakeDocs.map((d) => d.filedDocumentId).filter((x): x is string => !!x)];
  const suDocs = allDocIds.length ? await db.serviceUserDocument.findMany({ where: { id: { in: allDocIds }, organisationId: su.organisationId, serviceUserId: su.id }, select: { id: true, name: true, section: true, category: true, sensitive: true } }) : [];
  const docOf = (id: string | null): SourceDoc | null => {
    if (!id) return null;
    const own = suDocs.find((d) => d.id === id);
    const viaIntake = intakeDocs.find((d) => d.id === id);
    const filed = viaIntake?.filedDocumentId ? suDocs.find((d) => d.id === viaIntake.filedDocumentId) : undefined;
    const d = own ?? filed;
    if (d) {
      const restricted = d.sensitive && !sensitive;
      return { kind: "document", id: d.id, name: restricted ? `Restricted document (${categoryLabel(d.section, d.category)})` : d.name, section: d.section, restricted };
    }
    if (viaIntake) {
      const restricted = viaIntake.sensitive && !sensitive;
      return { kind: "intake", intakeId: viaIntake.intakeId, name: restricted ? "Restricted document" : viaIntake.name, restricted };
    }
    return { kind: "missing" };
  };

  const names = await memberNames(ctx, reg.rows.flatMap((r) => [r.createdById, r.verifiedById, r.supersededByUserId]));
  const rows = reg.rows.map((r) => {
    const source = docOf(r.sourceDocumentId);
    const hideQuote = !!source && source.kind !== "missing" && source.restricted;
    return {
      ...r,
      source,
      sourceQuote: hideQuote ? null : r.sourceQuote,
      state: (r.status === "SUPERSEDED" ? "SUPERSEDED" : r.verified ? "VERIFIED" : r.verifiedAt ? "REJECTED" : "AWAITING") as "SUPERSEDED" | "VERIFIED" | "REJECTED" | "AWAITING",
      addedBy: names.get(r.createdById) ?? "Former staff member",
      verifiedBy: r.verifiedById ? (names.get(r.verifiedById) ?? "Former staff member") : null,
      supersededBy: r.supersededByUserId ? (names.get(r.supersededByUserId) ?? "Former staff member") : null,
    };
  });
  const active = rows.filter((r) => r.status === "ACTIVE");

  // NHS number: Personal details stays the authoritative field; the register is compared with it, never copied over it.
  let nhs: NhsCheck = "RESTRICTED";
  if (sensitive) {
    const profile = su.nhsNumber?.replace(/\s+/g, "") || null;
    const reg = active.filter((r) => r.type === "NHS" && r.value).map((r) => r.value!.replace(/\s+/g, ""));
    nhs = !profile && !reg.length ? "NONE" : !reg.length ? "PROFILE_ONLY" : !profile ? "REGISTER_ONLY" : reg.every((v) => v === profile) ? "MATCH" : "DIFFERS";
  }

  // Older records: Frameworki numbers written into free text are offered for review, never moved automatically.
  const known = new Set(active.map((r) => r.value).filter(Boolean));
  const proposals: { value: string; where: string; quote: string; type: ReferenceType; clear: boolean }[] = [];
  if (canEdit) {
    const texts: [string, string | null][] = [
      ["Personal preferences", su.carePreferences],
      ["Access instructions", su.accessNotes],
      ["Communication needs", su.communicationNeeds],
      ...su.packages.flatMap((p) => [[`Care package reference`, p.reference] as [string, string | null], [`Care package requirements`, p.requirements] as [string, string | null]]),
    ];
    for (const [where, text] of texts) {
      if (!text) continue;
      for (const m of findFrameworki(text)) {
        if (known.has(m.value) || proposals.some((p) => p.value === m.value)) continue;
        const c = classifyReferenceContext(m.quote);
        proposals.push({ value: m.value, where, quote: m.quote, type: c.type, clear: c.clear });
      }
    }
  }

  // Documents a reference can be linked to: this person's, and only those this viewer can open.
  const docs = canEdit ? await db.serviceUserDocument.findMany({ where: { organisationId: su.organisationId, serviceUserId: su.id, archivedAt: null, ...(sensitive ? {} : { sensitive: false }) }, select: { id: true, name: true, section: true, category: true }, orderBy: { createdAt: "desc" }, take: 200 }) : [];

  const history = await db.auditLog.findMany({ where: { organisationId: su.organisationId, entityType: "ServiceUser", entityId: su.id, action: { in: HISTORY_ACTIONS } }, orderBy: { createdAt: "desc" }, take: 50 });
  const historyNames = await memberNames(ctx, history.map((h) => h.actorId));

  return {
    csbReference: reg.csbReference,
    legacyReference: reg.legacyReference && reg.legacyReference !== reg.csbReference ? reg.legacyReference : null,
    packages: su.packages.filter((p) => p.reference).map((p) => ({ id: p.id, reference: p.reference!, status: p.status, startDate: p.startDate, endDate: p.endDate })),
    rows,
    active,
    nhs,
    proposals,
    documents: docs.map((d) => ({ id: d.id, label: `${d.name} (${categoryLabel(d.section, d.category)})` })),
    history: history.map((h) => {
      const data = (h.data ?? {}) as { type?: string; verified?: boolean; reason?: string; systemLabel?: string | null; replacedById?: string | null };
      const hide = data.type === "NHS" && !sensitive;
      return { id: h.id, action: h.action, at: h.createdAt, actor: historyNames.get(h.actorId ?? "") ?? "System", type: data.type ?? null, verified: data.verified ?? null, systemLabel: data.systemLabel ?? null, replaced: !!data.replacedById, reason: hide ? null : (data.reason ?? null) };
    }),
    defaults: { issuer: TOWER_HAMLETS_COUNCIL, system: FRAMEWORKI },
  };
}
