import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "../audit-log";
import { notify, usersWithOrgRoles } from "../notifications/notify";
import { createDraftVersion, sectionsHash, toSectionInputs, type SectionInput } from "./versions";
import { performPublication } from "./workflow";

export interface SyncReport {
  safeApplied: { masterKey: string; heading: string }[];
  added: { masterKey: string; heading: string }[];
  conflicts: { key: string; heading: string; reason: string; proposedMasterText: string }[];
  preservedLocal: string[];
  masterRemoved: string[];
}

/**
 * Three-way merge of a master template update into one customer policy:
 * base = master version the customer text tracks, theirs = new master, ours = customer.
 * Only sections the customer has not customised are updated; customisations
 * and customer-specific (local) sections are preserved and conflicts flagged.
 */
export function mergeMasterUpdate(baseMaster: SectionInput[], newMaster: SectionInput[], customer: SectionInput[]) {
  const base = new Map(baseMaster.map((s) => [s.key, s]));
  const next = new Map(newMaster.map((s) => [s.key, s]));
  const report: SyncReport = { safeApplied: [], added: [], conflicts: [], preservedLocal: [], masterRemoved: [] };
  const result: SectionInput[] = [];
  const tracked = new Set<string>();

  for (const c of customer) {
    if (c.isLocal) {
      report.preservedLocal.push(c.heading);
      result.push(c);
      continue;
    }
    const mk = c.masterKey;
    if (!mk) {
      result.push(c);
      continue;
    }
    tracked.add(mk);
    const b = base.get(mk);
    const n = next.get(mk);
    if (!n) {
      report.masterRemoved.push(c.heading);
      result.push(c);
      continue;
    }
    const masterChanged = !b || b.body !== n.body || b.heading !== n.heading;
    if (!masterChanged) {
      result.push(c);
      continue;
    }
    const customised = !b || b.body !== c.body || b.heading !== c.heading;
    if (!customised) {
      result.push({ ...c, body: n.body, heading: n.heading });
      report.safeApplied.push({ masterKey: mk, heading: n.heading });
    } else {
      result.push(c);
      report.conflicts.push({ key: c.key, heading: c.heading, reason: "You have customised this section and the master template also changed it. Your wording has been kept; review the master text and decide.", proposedMasterText: n.body });
    }
  }
  newMaster.forEach((n, i) => {
    if (tracked.has(n.key) || base.has(n.key) || n.isLocal) return;
    const prevKey = newMaster[i - 1]?.key;
    const at = prevKey ? result.findIndex((r) => r.masterKey === prevKey) : -1;
    result.splice(at + 1 || result.length, 0, { key: n.key, heading: n.heading, body: n.body, isLocal: false, masterKey: n.key });
    report.added.push({ masterKey: n.key, heading: n.heading });
  });
  return { sections: result, report };
}

/**
 * Job: after CSB publishes a central (master) version, every organisation copy derived from it receives the update
 * automatically, with no adoption, review or approval step for the organisation (owner's brief, 5 Nov 2026).
 *
 * For each organisation copy the update is three-way merged (mergeMasterUpdate): sections the organisation has not
 * customised take the new central wording, new central sections are added, and local sections and customised
 * sections keep the organisation's wording. The merged text is published straight away as a new version; customised
 * sections where CSB's wording also changed are reported for attention, never overwritten, and never block the rest of
 * the update. Idempotent: a copy already based on this central version, or with a sync revision for it, is skipped,
 * so a retried job never creates duplicate versions or policies.
 */
export async function syncCustomersFromMaster(masterVersionId: string) {
  const masterVersion = await db.policyVersion.findUniqueOrThrow({ where: { id: masterVersionId }, include: { sections: true, policy: true, publication: true } });
  if (masterVersion.status !== "PUBLISHED" && masterVersion.status !== "SUPERSEDED") return [];
  const publisherId = masterVersion.publication?.publishedById ?? "system";
  const derived = await db.policy.findMany({ where: { templateId: masterVersion.policyId, kind: "CUSTOMER", status: "ACTIVE" }, include: { currentPublishedVersion: { include: { sections: true, publication: true } } } });
  const results: { policyId: string; revisionId: string | null; report: SyncReport | null; skipped?: string; published?: boolean; error?: string }[] = [];
  for (const p of derived) {
    const current = p.currentPublishedVersion;
    if (!current) {
      results.push({ policyId: p.id, revisionId: null, report: null, skipped: "No published customer version" });
      continue;
    }
    if (current.basedOnMasterVersionId === masterVersionId) {
      results.push({ policyId: p.id, revisionId: null, report: null, skipped: "Already on this central version" });
      continue;
    }
    const existing = await db.policyRevision.findFirst({ where: { policyId: p.id, kind: "MASTER_SYNC", draftVersion: { basedOnMasterVersionId: masterVersionId } } });
    if (existing) {
      results.push({ policyId: p.id, revisionId: existing.id, report: existing.validation as unknown as SyncReport, skipped: "Already prepared" });
      continue;
    }
    const baseMaster = current.basedOnMasterVersionId
      ? toSectionInputs((await db.policyVersion.findUniqueOrThrow({ where: { id: current.basedOnMasterVersionId }, include: { sections: true } })).sections)
      : [];
    const { sections, report } = mergeMasterUpdate(baseMaster, toSectionInputs(masterVersion.sections), toSectionInputs(current.sections));
    if (!report.safeApplied.length && !report.added.length) {
      // Nothing CSB changed reaches this copy's text. Conflicts alone are reported without a new version.
      if (report.conflicts.length) await notifyConflicts(p, masterVersion, report, null);
      results.push({ policyId: p.id, revisionId: null, report, skipped: "Central changes do not affect this organisation's text" });
      continue;
    }
    const previousPub = current.publication;
    const requiresAck = previousPub?.requiresAcknowledgement ?? false;
    try {
      const { revision, publication } = await db.$transaction(async (tx) => {
        const draft = await createDraftVersion(tx, {
          policyId: p.id,
          organisationId: p.organisationId,
          sections,
          origin: "MASTER_SYNC",
          previousVersionId: current.id,
          basedOnMasterVersionId: masterVersionId,
          changeSummary: masterVersion.changeSummary?.trim() || `CSB central update to ${masterVersion.label}`,
          reasonForChange: `CSB central update ${masterVersion.policy.ref} ${masterVersion.label}: ${report.safeApplied.length} section(s) updated, ${report.added.length} added${report.conflicts.length ? `, ${report.conflicts.length} customised section(s) kept your wording` : ""}.`,
          isSimulated: masterVersion.isSimulated,
        });
        const revision = await tx.policyRevision.create({
          data: {
            policyId: p.id,
            organisationId: p.organisationId,
            kind: "MASTER_SYNC",
            baseVersionId: current.id,
            draftVersionId: draft.id,
            title: `${masterVersion.isSimulated ? "[SIMULATED] " : ""}CSB central update to ${p.ref} ${p.title}`,
            explanation: draft.reasonForChange,
            validation: report as unknown as Prisma.InputJsonValue,
            isSimulated: masterVersion.isSimulated,
            substantive: true,
          },
        });
        const publication = await tx.policyPublication.create({
          data: {
            policyId: p.id,
            organisationId: p.organisationId,
            versionId: draft.id,
            status: "PUBLISHED",
            effectiveDate: masterVersion.effectiveDate ?? new Date(),
            publishedById: publisherId,
            requiresAcknowledgement: requiresAck,
            materialRevision: true,
            acknowledgementDueAt: requiresAck ? new Date(Date.now() + 14 * 86400_000) : null,
          },
        });
        await audit({ organisationId: p.organisationId, action: "revision.master_sync_created", entityType: "PolicyRevision", entityId: revision.id, data: { masterVersionId, automatic: true, ...report } as unknown as Prisma.InputJsonValue }, tx);
        return { revision, publication };
      });
      // Same locked, serialisable publication step as a person publishing: it refuses if the copy changed meanwhile.
      await performPublication(publication.id);
      await carryForwardOpenDrafts(p.id, current.id, publication.versionId, baseMaster, toSectionInputs(masterVersion.sections), masterVersionId);
      if (report.conflicts.length) await notifyConflicts(p, masterVersion, report, revision.id);
      results.push({ policyId: p.id, revisionId: revision.id, report, published: true });
    } catch (e) {
      // One organisation's problem (for example a copy republished at the same moment) never stops the others.
      results.push({ policyId: p.id, revisionId: null, report, error: (e as Error).message });
    }
  }
  return results;
}

/** Tells the organisation's policy people where CSB changed a section they had customised. Their wording is kept. */
async function notifyConflicts(p: { id: string; organisationId: string | null; ref: string; title: string }, masterVersion: { id: string; label: string }, report: SyncReport, revisionId: string | null) {
  if (!p.organisationId) return;
  await notify({
    organisationId: p.organisationId,
    userIds: await usersWithOrgRoles(p.organisationId, ["POLICY_AUTHOR", "POLICY_APPROVER", "ORG_ADMIN"]),
    type: "policy.central_update_attention",
    title: `CSB updated wording you have customised: ${p.ref} ${p.title}`,
    body: `CSB published ${masterVersion.label}. Your wording was kept in ${report.conflicts.map((c) => c.heading).join(", ")}. Compare it with the new CSB text and start a revision if you want to change it. The rest of the update is already live.`,
    reason: "Your organisation has customised this CSB policy.",
    links: [{ label: "Compare versions", url: `/policies/${p.id}/compare` }],
    actionUrl: `/policies/${p.id}/compare`,
    dedupeKey: `master-sync-attention:${p.id}:${masterVersion.id}`,
  });
  if (revisionId) await audit({ organisationId: p.organisationId, action: "policy.central_update_conflicts", entityType: "PolicyRevision", entityId: revisionId, data: { masterVersionId: masterVersion.id, sections: report.conflicts.map((c) => c.heading) } });
}

/**
 * A draft someone was already writing would now be based on a superseded version and could not be published. Its
 * sections get the same merge (their edits and local sections win), and it is re-based on the new version, so the
 * work in progress survives the central update. Drafts frozen under the old review process are left as they are.
 */
async function carryForwardOpenDrafts(policyId: string, previousVersionId: string, newVersionId: string, baseMaster: SectionInput[], newMaster: SectionInput[], masterVersionId: string) {
  const open = await db.policyRevision.findMany({ where: { policyId, closedAt: null, baseVersionId: previousVersionId, draftVersion: { status: { in: ["DRAFT", "CHANGES_REQUESTED"] } } }, include: { draftVersion: { include: { sections: true } } } });
  for (const r of open) {
    const { sections } = mergeMasterUpdate(baseMaster, newMaster, toSectionInputs(r.draftVersion.sections));
    await db.$transaction(async (tx) => {
      await tx.policySection.deleteMany({ where: { versionId: r.draftVersionId } });
      await tx.policySection.createMany({ data: sections.map((x, i) => ({ versionId: r.draftVersionId, key: x.key, heading: x.heading, body: x.body, position: i, isLocal: Boolean(x.isLocal), masterKey: x.masterKey ?? null })) });
      await tx.policyVersion.update({ where: { id: r.draftVersionId }, data: { previousVersionId: newVersionId, basedOnMasterVersionId: masterVersionId, contentHash: sectionsHash(sections) } });
      await tx.policyRevision.update({ where: { id: r.id }, data: { baseVersionId: newVersionId } });
      await audit({ organisationId: r.organisationId, action: "revision.rebased_on_central_update", entityType: "PolicyRevision", entityId: r.id, data: { from: previousVersionId, to: newVersionId, masterVersionId } }, tx);
    });
  }
}
