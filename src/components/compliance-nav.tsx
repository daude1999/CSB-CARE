import Link from "@/components/link";
import { BookOpenText, ChartLine, ClipboardText, Newspaper, Signature, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { hasOrgPermission, hasPlatformPermission, type Ctx } from "@/server/auth/rbac";
import type { ShellItem } from "@/components/portal-switcher";

/**
 * Policy & Compliance is six workspaces. Each sidebar entry opens one workspace; the workspace's tabs are the pages
 * that used to be separate entries, and they keep their old addresses (/changes, /queue, /audits and so on), so
 * bookmarks, notification links and server actions still work. Every tab appears only for people with the permission
 * its page checks on the server.
 */
export type WorkspaceId = "library" | "regulatory" | "signoff" | "improvements";
export type WorkspaceTab = { key: string; label: string; href: string };

/** Who may open the Review & Approval Queue: the people the queue page itself lets in. */
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
          { key: "templates", label: "Templates", href: "/policies?tab=templates", show: true },
          { key: "archived", label: "Archived", href: "/policies?tab=archived", show: org },
          { key: "calendar", label: "Review Calendar", href: "/policies?tab=calendar", show: org },
          { key: "queue", label: "Review & Approval Queue", href: "/queue", show: canUseQueue(ctx) },
        ];
      case "regulatory":
        return [
          { key: "updates", label: "Regulatory Updates", href: "/changes", show: true },
          { key: "requirements", label: "Requirements Register", href: "/requirements", show: true },
          { key: "sources", label: "Source Status", href: "/compliance/regulatory/sources", show: true },
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
    }
  })();
  return tabs.filter((t) => t.show).map((t) => ({ key: t.key, label: t.label, href: t.href }));
}

/** Where a workspace opens for this person: its first tab they may use, or null when they may use none. */
export function workspaceHome(ctx: Ctx, ws: WorkspaceId): string | null {
  return workspaceTabs(ctx, ws)[0]?.href ?? null;
}

/** The six Policy & Compliance sidebar entries. `match` keeps an entry lit on its workspace's tab pages. */
export function complianceItems(ctx: Ctx, i: { size: number }): ShellItem[] {
  const org = Boolean(ctx.organisationId);
  const items: (ShellItem & { show: boolean })[] = [
    { href: "/", label: "Compliance Dashboard", icon: <Sparkle {...i} />, show: true },
    { href: "/policies", label: org ? "Policy Library" : "Template Library", icon: <BookOpenText {...i} />, match: ["/queue", "/revisions"], show: true },
    { href: "/compliance/regulatory", label: "Regulatory Monitoring", icon: <Newspaper {...i} />, match: ["/changes", "/requirements", "/sources"], show: true },
    { href: workspaceHome(ctx, "signoff") ?? "/acknowledgements", label: "Staff Sign-off", icon: <Signature {...i} />, match: ["/staff", "/acknowledgements"], show: org },
    { href: "/compliance/improvements", label: "Audits & Improvements", icon: <ClipboardText {...i} />, match: ["/audits", "/actions", "/evidence", "/compliance/risks"], show: org && workspaceHome(ctx, "improvements") !== null },
    { href: "/compliance/reports", label: "Compliance Reports", icon: <ChartLine {...i} />, show: hasOrgPermission(ctx, "report.view") },
  ];
  return items.filter((x) => x.show).map((x) => ({ href: x.href, label: x.label, icon: x.icon, ...(x.match ? { match: x.match } : {}) }));
}

/** A workspace's tabs, under the page's title bar. The tab for the page on screen is marked as the current page. */
export function ComplianceTabs({ ctx, ws, active }: { ctx: Ctx; ws: WorkspaceId; active: string }) {
  const tabs = workspaceTabs(ctx, ws);
  if (tabs.length < 2) return null;
  const label = { library: "Policy Library", regulatory: "Regulatory Monitoring", signoff: "Staff Sign-off", improvements: "Audits & Improvements" }[ws];
  return (
    <nav aria-label={`${label} sections`} className="ws-tabs" data-testid={`ws-tabs-${ws}`}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className="ws-tab" aria-current={t.key === active ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
