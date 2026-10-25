import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "../audit-log";
import { notify, usersWithOrgRoles } from "../notifications/notify";
import { createDraftVersion, toSectionInputs, type SectionInput } from "./versions";

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

/** Job: after a master template version is published, prepare customer-specific drafts for approval. */
export async function syncCustomersFromMaster(masterVersionId: string) {
  const masterVersion = await db.policyVersion.findUniqueOrThrow({ where: { id: masterVersionId }, include: { sections: true, policy: true } });
  const derived = await db.policy.findMany({ where: { templateId: masterVersion.policyId, status: "ACTIVE" }, include: { currentPublishedVersion: { include: { sections: true } } } });
  const results: { policyId: string; revisionId: string | null; report: SyncReport | null; skipped?: string }[] = [];
  for (const p of derived) {
    const current = p.currentPublishedVersion;
    if (!current) {
      results.push({ policyId: p.id, revisionId: null, report: null, skipped: "No published customer version" });
      continue;
    }
    const existing = await db.policyRevision.findFirst({ where: { policyId: p.id, kind: "MASTER_SYNC", closedAt: null, draftVersion: { basedOnMasterVersionId: masterVersionId } } });
    if (existing) {
      results.push({ policyId: p.id, revisionId: existing.id, report: existing.validation as unknown as SyncReport });
      continue;
    }
    if (current.basedOnMasterVersionId === masterVersionId) continue;
    const baseMaster = current.basedOnMasterVersionId
      ? toSectionInputs((await db.policyVersion.findUniqueOrThrow({ where: { id: current.basedOnMasterVersionId }, include: { sections: true } })).sections)
      : [];
    const { sections, report } = mergeMasterUpdate(baseMaster, toSectionInputs(masterVersion.sections), toSectionInputs(current.sections));
    if (!report.safeApplied.length && !report.added.length && !report.conflicts.length) {
      results.push({ policyId: p.id, revisionId: null, report, skipped: "Master changes do not affect this customer's text" });
      continue;
    }
    const rev = await db.$transaction(async (tx) => {
      const draft = await createDraftVersion(tx, {
        policyId: p.id,
        organisationId: p.organisationId,
        sections,
        origin: "MASTER_SYNC",
        previousVersionId: current.id,
        basedOnMasterVersionId: masterVersionId,
        changeSummary: `Master template ${masterVersion.policy.ref} updated to ${masterVersion.label}: ${report.safeApplied.length} section(s) updated, ${report.added.length} added, ${report.conflicts.length} need your decision.`,
        reasonForChange: masterVersion.changeSummary ?? masterVersion.reasonForChange ?? "Master template updated",
        isSimulated: masterVersion.isSimulated,
      });
      const r = await tx.policyRevision.create({
        data: {
          policyId: p.id,
          organisationId: p.organisationId,
          kind: "MASTER_SYNC",
          baseVersionId: current.id,
          draftVersionId: draft.id,
          title: `${masterVersion.isSimulated ? "[SIMULATED] " : ""}Apply master update to ${p.ref} ${p.title}`,
          explanation: draft.changeSummary,
          validation: report as unknown as Prisma.InputJsonValue,
          isSimulated: masterVersion.isSimulated,
          substantive: true,
        },
      });
      await audit({ organisationId: p.organisationId, action: "revision.master_sync_created", entityType: "PolicyRevision", entityId: r.id, data: { masterVersionId, ...report } as unknown as Prisma.InputJsonValue }, tx);
      return r;
    });
    await notify({
      organisationId: p.organisationId,
      userIds: await usersWithOrgRoles(p.organisationId!, ["POLICY_AUTHOR", "POLICY_APPROVER", "ORG_ADMIN"]),
      type: "revision.master_update",
      title: `Template update ready for your approval: ${p.ref} ${p.title}`,
      body: `${report.safeApplied.length + report.added.length} change(s) prepared; ${report.conflicts.length} customised section(s) need your decision. Your policy has not been changed and will not be until you approve and publish.`,
      reason: "Your organisation uses this Evantix template.",
      links: [{ label: "Review draft", url: `/revisions/${rev.id}` }],
      actionUrl: `/revisions/${rev.id}`,
      dedupeKey: `master-sync:${rev.id}`,
    });
    results.push({ policyId: p.id, revisionId: rev.id, report });
  }
  return results;
}
