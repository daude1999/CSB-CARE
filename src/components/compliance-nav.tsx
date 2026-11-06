import { BookOpenText, ChartLine, ClipboardText, Newspaper, SealCheck, Signature, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { hasOrgPermission, hasPlatformPermission, type Ctx } from "@/server/auth/rbac";
import type { ShellItem } from "@/components/portal-switcher";
import { PcTabs } from "@/components/compliance-ui";
import { workspaceCounts } from "@/server/compliance/workspace-counts";

/**
 * Policy & Compliance is six workspaces. Each sidebar entry opens one workspace; the workspace's tabs are the pages
 * that used to be separate entries, and they keep their old addresses (/changes, /queue, /audits and so on), so
 * bookmarks, notification links and server actions still work. Every tab appears only for people with the permission
 * its page checks on the server.
 */
export type WorkspaceId = "library" | "regulatory" | "signoff" | "improvements" | "cqc";

/** Who may open any part of CQC Inspection & Evidence. */
export function canUseCqc(ctx: Ctx) {
  return hasOrgPermission(ctx, "cqc.view") || hasOrgPermission(ctx, "rca.view") || hasOrgPermission(ctx, "rca.investigate");
}
export type WorkspaceTab = { key: string; label: string; href: string };

/** Who may open Drafts (formerly the Review & Approval Queue): the people the page itself lets in. */
export function canUseQueue(ctx: Ctx) {
  return hasOrgPermission(ctx, "policy.author") || hasOrgPermission(ctx, "policy.review") || hasOrgPermission(ctx, "policy.approve") || hasPlatformPermission(ctx, "master.review") || hasPlatformPermission(ctx, "master.author");
}

export function workspaceTabs(ctx: Ctx, ws: WorkspaceId): WorkspaceTab[] {
  const org = Boolean(ctx.organisationId);
  const tabs: (WorkspaceTab & { show: boolean })[] = (() => {
    switch (ws) {
      case "library":
        return [
          { key: "policies", label: "My Policies", href: "/policies", show: org },
          { key: "forms", label: "Forms & Resources", href: "/policies/forms", show: true },
          { key: "templates", label: "CSB Central Library", href: "/policies?tab=templates", show: true },
          { key: "archived", label: "Archived", href: "/policies?tab=archived", show: org },
          { key: "calendar", label: "Review Calendar", href: "/policies?tab=calendar", show: org },
          { key: "queue", label: "Drafts", href: "/queue", show: canUseQueue(ctx) },
          { key: "updates", label: "Monthly Updates", href: "/policies/updates", show: org },
          { key: "generator", label: "Policy Generator", href: "/policies/generator", show: org && hasOrgPermission(ctx, "policy.author") },
          { key: "coverage", label: "Branch Coverage", href: "/policies/coverage", show: org && hasOrgPermission(ctx, "policy.coverage") },
          { key: "branches", label: "Branch Configuration", href: "/policies/branches", show: org && hasOrgPermission(ctx, "policy.localConfig") },
        ];
      case "regulatory":
        return [
          { key: "updates", label: "Regulatory Updates", href: "/changes", show: true },
          { key: "requirements", label: "Requirements Register", href: "/requirements", show: true },
          { key: "sources", label: "Source Status", href: "/compliance/regulatory/sources", show: true },
          { key: "references", label: "Local & Safeguarding References", href: "/compliance/regulatory/references", show: org },
        ];
      case "signoff": {
        const manager = hasOrgPermission(ctx, "staff.view");
        return [
          { key: "overview", label: "Overview", href: "/staff", show: manager },
          { key: "people", label: "By Employee", href: "/staff?view=people", show: manager },
          { key: "policies", label: "By Policy", href: "/staff?view=policies", show: manager },
          { key: "overdue", label: "Overdue", href: "/staff?view=rows&status=overdue", show: manager },
          { key: "rules", label: "Assignment Rules", href: "/staff/rules", show: manager },
          { key: "reading", label: "My Reading List", href: "/acknowledgements", show: org },
        ];
      }
      case "improvements":
        return [
          { key: "audits", label: "Audits & Inspections", href: "/audits", show: hasOrgPermission(ctx, "audit.conduct") },
          { key: "actions", label: "Corrective Actions", href: "/actions", show: org },
          { key: "risks", label: "Risk Register", href: "/compliance/risks", show: hasOrgPermission(ctx, "risk.view") },
          { key: "evidence", label: "Evidence Library", href: "/evidence", show: hasOrgPermission(ctx, "evidence.read") },
        ];
      case "cqc": {
        // CQC Inspection & Evidence (owner's spec of 4 Nov 2026): one workspace, six tabs, reusing the records above.
        const cqc = hasOrgPermission(ctx, "cqc.view");
        const rca = hasOrgPermission(ctx, "rca.view") || hasOrgPermission(ctx, "rca.investigate");
        return [
          { key: "overview", label: "Overview", href: "/compliance/cqc", show: cqc },
          { key: "assessments", label: "CQC Assessment", href: "/compliance/cqc/assessments", show: cqc },
          { key: "evidence", label: "Evidence", href: "/compliance/cqc/evidence", show: cqc },
          { key: "rca", label: "Root Cause Analysis", href: "/compliance/cqc/rca", show: rca },
          { key: "actions", label: "Improvement Actions", href: "/compliance/cqc/actions", show: cqc || rca },
          { key: "reports", label: "Reports", href: "/compliance/cqc/reports", show: cqc || rca },
        ];
      }
    }
  })();
  return tabs.filter((t) => t.show).map((t) => ({ key: t.key, label: t.label, href: t.href }));
}

/** Where a workspace opens for this person: its first tab they may use, or null when they may use none. */
export function workspaceHome(ctx: Ctx, ws: WorkspaceId): string | null {
  return workspaceTabs(ctx, ws)[0]?.href ?? null;
}

/** The Policy & Compliance sidebar entries (the six workspaces plus CQC Inspection & Evidence). `match` keeps an entry lit on its workspace's tab pages. */
export function complianceItems(ctx: Ctx, i: { size: number }): ShellItem[] {
  const org = Boolean(ctx.organisationId);
  const items: (ShellItem & { show: boolean })[] = [
    { href: "/", label: "Compliance Dashboard", icon: <Sparkle {...i} />, show: true },
    { href: "/policies", label: org ? "Policy Library" : "Template Library", icon: <BookOpenText {...i} />, match: ["/queue", "/revisions"], show: true },
    { href: "/compliance/regulatory", label: "Regulatory Monitoring", icon: <Newspaper {...i} />, match: ["/changes", "/requirements", "/sources"], show: true },
    { href: workspaceHome(ctx, "signoff") ?? "/acknowledgements", label: "Staff Sign-off", icon: <Signature {...i} />, match: ["/staff", "/acknowledgements"], show: org },
    { href: "/compliance/improvements", label: "Audits & Improvements", icon: <ClipboardText {...i} />, match: ["/audits", "/actions", "/evidence", "/compliance/risks"], show: org && workspaceHome(ctx, "improvements") !== null },
    { href: "/compliance/reports", label: "Compliance Reports", icon: <ChartLine {...i} />, show: hasOrgPermission(ctx, "report.view") },
    { href: workspaceHome(ctx, "cqc") ?? "/compliance/cqc", label: "CQC Inspection & Evidence", icon: <SealCheck {...i} />, match: ["/compliance/cqc"], show: org && canUseCqc(ctx) },
  ];
  return items.filter((x) => x.show).map((x) => ({ href: x.href, label: x.label, icon: x.icon, ...(x.match ? { match: x.match } : {}) }));
}

/** The six workspaces' names, for breadcrumbs and tab labels. */
export const WORKSPACE_NAMES: Record<WorkspaceId, string> = { library: "Policy Library", regulatory: "Regulatory Monitoring", signoff: "Staff Sign-off", improvements: "Audits & Improvements", cqc: "CQC Inspection & Evidence" };

/**
 * A workspace's tabs, under the page header, each with the number of records it lists for this person. The tab for
 * the page on screen is marked as the current page.
 */
export async function ComplianceTabs({ ctx, ws, active }: { ctx: Ctx; ws: WorkspaceId; active: string }) {
  const tabs = workspaceTabs(ctx, ws);
  if (tabs.length < 2 && ws !== "cqc") return null;
  const counts = await workspaceCounts(ctx, ws);
  return <PcTabs label={`${WORKSPACE_NAMES[ws]} sections`} testId={`ws-tabs-${ws}`} active={active} items={tabs.map((t) => ({ ...t, count: counts[t.key] }))} />;
}
