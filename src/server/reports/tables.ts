import { ackBucket, BUCKET_LABEL } from "@/server/policies/assignment";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { hasOrgPermission, hasPlatformPermission, type Ctx } from "../auth/rbac";

export type ReportKind = "policies" | "acknowledgements" | "changes" | "actions";
export const REPORTS: Record<ReportKind, string> = {
  policies: "Policy register",
  acknowledgements: "Acknowledgement compliance",
  changes: "Regulatory change log",
  actions: "Actions register",
};

/** Report rows computed from the database, scoped to the caller's organisation. */
export async function reportRows(ctx: Ctx, kind: string): Promise<{ columns: string[]; rows: (string | number)[][] }> {
  if (!(kind in REPORTS)) throw new NotFoundError("Report");
  if (!hasOrgPermission(ctx, "report.view") && !hasPlatformPermission(ctx, "sources.manage")) throw new ForbiddenError();
  const orgId = ctx.organisationId;
  const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "");
  switch (kind as ReportKind) {
    case "policies": {
      const ps = await db.policy.findMany({ where: orgId ? { organisationId: orgId } : { kind: "MASTER" }, orderBy: { ref: "asc" }, include: { category: true, currentPublishedVersion: { include: { approvals: { where: { decision: "APPROVE" } } } } } });
      return {
        columns: ["Reference", "Title", "Category", "Version", "Origin", "Approvals", "Published", "Effective", "Next review", "Status"],
        rows: ps.map((p) => [p.ref, p.title, p.category.name, p.currentPublishedVersion?.label ?? "", p.currentPublishedVersion?.origin ?? "", p.currentPublishedVersion?.approvals.length ?? 0, d(p.currentPublishedVersion?.publishedAt), d(p.currentPublishedVersion?.effectiveDate), d(p.nextReviewDate), p.status]),
      };
    }
    case "acknowledgements": {
      if (!orgId) return { columns: ["Note"], rows: [["Select an organisation"]] };
      // Branch-limited managers see acknowledgements of members based in their branches (and members without a branch).
      const branchLimit = ctx.branchIds ? { user: { memberships: { some: { organisationId: orgId, OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } } } } : {};
      const acks = await db.acknowledgement.findMany({ where: { organisationId: orgId, supersededAt: null, ...branchLimit }, include: { user: { select: { name: true } }, staffMember: { select: { displayName: true } }, publication: { include: { policy: { select: { ref: true, title: true } }, version: { select: { label: true } } } } }, orderBy: { createdAt: "desc" } });
      return {
        columns: ["Staff member", "Policy", "Version", "State", "Due", "Acknowledged", "Overdue"],
        rows: acks.map((a) => {
          const b = ackBucket(a);
          return [a.staffMember?.displayName ?? a.user?.name ?? "", `${a.publication.policy.ref} ${a.publication.policy.title}`, a.publication.version.label, BUCKET_LABEL[b.bucket], d(a.dueAt), d(a.acknowledgedAt), b.overdue ? "yes" : "no"];
        }),
      };
    }
    case "changes": {
      const cs = await db.regulatoryChange.findMany({ orderBy: { detectedAt: "desc" }, take: 500, include: { source: { select: { name: true } } } });
      return {
        columns: ["Detected", "Title", "Source", "Classification", "Status", "Urgency", "Simulated", "URL"],
        rows: cs.map((c) => [d(c.detectedAt), c.title, c.source.name, c.classification, c.status, c.suggestedUrgency, c.isSimulated ? "SIMULATED" : "", c.canonicalUrl]),
      };
    }
    case "actions": {
      if (!orgId) return { columns: ["Note"], rows: [["Select an organisation"]] };
      const as = await db.complianceAction.findMany({ where: { organisationId: orgId }, orderBy: { dueDate: "asc" } });
      const names = new Map((await db.user.findMany({ where: { id: { in: as.map((a) => a.ownerId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      return {
        columns: ["Title", "Owner", "Due", "Status", "Completed", "Verified"],
        rows: as.map((a) => [a.title, names.get(a.ownerId) ?? "", d(a.dueDate), a.status, d(a.completedAt), d(a.verifiedAt)]),
      };
    }
  }
}

/** RFC 4180 CSV with formula-injection protection for spreadsheet users. */
export function toCsv(columns: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
