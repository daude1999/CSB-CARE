/**
 * The Admin Centre's information architecture: six workspaces, each with its own pages. The sidebar shows the
 * workspaces; the bar above each page shows the open workspace's pages. Every URL from the first Admin Centre is kept.
 */
export type WorkspaceIcon = "overview" | "clients" | "accounts" | "billing" | "operations" | "settings";

export interface WorkspacePage {
  href: string;
  label: string;
  /** Only this exact path (not its children) marks the page as open. */
  exact?: boolean;
  /** Other paths that belong to this page (e.g. a detail page under a list). */
  also?: string[];
}

export interface Workspace {
  key: string;
  label: string;
  icon: WorkspaceIcon;
  href: string;
  pages: WorkspacePage[];
}

export const WORKSPACES: Workspace[] = [
  { key: "overview", label: "Overview", icon: "overview", href: "/platform-admin", pages: [
    { href: "/platform-admin", label: "Dashboard", exact: true },
  ] },
  { key: "clients", label: "Clients", icon: "clients", href: "/platform-admin/clients", pages: [
    { href: "/platform-admin/clients", label: "All Clients", exact: true },
    { href: "/platform-admin/clients/new", label: "Add Client" },
    { href: "/platform-admin/onboarding", label: "Onboarding" },
  ] },
  { key: "accounts", label: "Accounts & Access", icon: "accounts", href: "/platform-admin/users", pages: [
    { href: "/platform-admin/users", label: "Users" },
    { href: "/platform-admin/administrators", label: "Administrators" },
    { href: "/platform-admin/passwords", label: "Passwords" },
    { href: "/platform-admin/roles", label: "Roles & Permissions" },
    { href: "/platform-admin/sessions", label: "Sessions" },
  ] },
  { key: "billing", label: "Subscriptions & Billing", icon: "billing", href: "/platform-admin/subscriptions", pages: [
    { href: "/platform-admin/subscriptions", label: "Subscriptions" },
    { href: "/platform-admin/plans", label: "Plans" },
    { href: "/platform-admin/billing", label: "Invoices" },
    { href: "/platform-admin/renewals", label: "Trials & Renewals" },
  ] },
  { key: "operations", label: "Platform Operations", icon: "operations", href: "/platform-admin/health", pages: [
    { href: "/platform-admin/health", label: "System Health" },
    { href: "/platform-admin/jobs", label: "Background Jobs" },
    { href: "/platform-admin/ai", label: "AI" },
    { href: "/platform-admin/modules", label: "Modules" },
    { href: "/platform-admin/storage", label: "Storage" },
  ] },
  { key: "settings", label: "Settings & Security", icon: "settings", href: "/platform-admin/settings", pages: [
    { href: "/platform-admin/settings", label: "Platform Settings" },
    { href: "/platform-admin/security", label: "Security Audit" },
    { href: "/platform-admin/support", label: "Support Access" },
    { href: "/platform-admin/notifications", label: "Notifications" },
    { href: "/platform-admin/activity", label: "Activity History" },
  ] },
];

const matches = (path: string, p: WorkspacePage) => (p.exact ? path === p.href : path === p.href || path.startsWith(p.href + "/")) || (p.also ?? []).some((a) => path === a || path.startsWith(a + "/"));

/** The open workspace and page for a path. The most specific match wins (so /clients/new is Add Client, not All Clients). */
export function locate(path: string): { workspace: Workspace; page: WorkspacePage | null } {
  let best: { workspace: Workspace; page: WorkspacePage; len: number } | null = null;
  for (const w of WORKSPACES) for (const p of w.pages) if (matches(path, p) && (!best || p.href.length > best.len)) best = { workspace: w, page: p, len: p.href.length };
  if (best) return { workspace: best.workspace, page: best.page };
  // A client's own workspace (/clients/<id>) belongs to Clients without marking a page.
  if (path.startsWith("/platform-admin/clients/")) return { workspace: WORKSPACES[1]!, page: null };
  return { workspace: WORKSPACES[0]!, page: null };
}
