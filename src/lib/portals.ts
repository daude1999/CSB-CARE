/**
 * The portals of the CSB All in One Platform. Each portal is a real set of routes with its own side menu.
 * A portal that is not built yet has `planned` set; it opens an honest "not built yet" page and never shows figures.
 * Which portals a person may open is decided on the server by `portalsFor` in src/server/auth/portals.ts.
 */
/** The Overview landing page plus exactly five business modules. */
export type PortalId = "overview" | "policy" | "rota" | "hr" | "reporting" | "admin";

export interface Portal {
  id: PortalId;
  name: string;
  code: string;
  summary: string;
  /** Where the portal opens. */
  home: string;
  /** The stage that builds a planned portal, shown on its label. */
  planned?: string;
  /** The module colour (Harbour, 13 Nov 2026): the menu icon, page-header icon, sub-tab pills, default panel bar and Overview tile. White text on it meets WCAG AA. */
  colour: string;
  /** A light tint of the module colour for panels behind figures. */
  tint: string;
}

export const PORTALS: readonly Portal[] = [
  { id: "overview", name: "Overview", code: "OV", summary: "Today across every portal", home: "/overview", colour: "#1f3a68", tint: "#eef2f8" },
  { id: "policy", name: "Policy & Compliance", code: "PC", summary: "Policies, regulatory updates, audits, actions", home: "/", colour: "#2e5bcf", tint: "#eff3fd" },
  { id: "rota", name: "Rostering & Care Management", code: "RC", summary: "Service users, rota, visits, call monitoring, care records, finance", home: "/rota", colour: "#0f766e", tint: "#e9f5f2" },
  { id: "hr", name: "HR & Workforce", code: "HR", summary: "Your HR Hub: people, compliance, documents", home: "/hr/dashboard", colour: "#b4532a", tint: "#fcf1ea" },
  { id: "reporting", name: "Reporting & Analytics", code: "RA", summary: "Measures, reports and the AI assistant", home: "/analytics", colour: "#0e7490", tint: "#e7f3f6" },
  { id: "admin", name: "Administration & Settings", code: "AD", summary: "Settings, users, sources, jobs", home: "/settings", colour: "#5b5e96", tint: "#f0f0f7" },
];


const PREFIXES: [string, PortalId][] = [
  ["/overview", "overview"],
  // Service users and call monitoring are part of Rostering & Care Management; /service-users redirects there.
  ["/service-users", "rota"],
  // Rota reports have their home in Reporting & Analytics. Compliance Reports is one of Policy & Compliance's six
  // workspaces (owner's brief of 3 Nov 2026) and is also listed in the Reporting menu.
  ["/rota/reports", "reporting"],
  ["/rota/insights", "reporting"],
  ["/rota", "rota"],
  ["/carer", "rota"],
  ["/workforce", "hr"],
  ["/hr", "hr"],
  ["/reports", "reporting"],
  ["/analytics", "reporting"],
  ["/assistant", "reporting"],
  ["/settings", "admin"],
  ["/modules", "admin"],
  ["/admin", "admin"],
  ["/no-access", "overview"],
  ["/notifications", "overview"],
];

/** The portal a path belongs to. Every page not claimed by another portal is part of Policy & Compliance. */
export function portalForPath(path: string): PortalId {
  for (const [prefix, id] of PREFIXES) if (path === prefix || path.startsWith(prefix + "/")) return id;
  return "policy";
}

/**
 * The HR Hub's screens (/hr/...) bring their own style sheet as well as the platform's. Moving between them and any
 * other page is a full page load, so that style sheet only ever exists on HR Hub pages.
 */
export function isHubPath(path: string): boolean {
  return path === "/hr" || path.startsWith("/hr/");
}

/** Sent on window by the platform's top-bar search on HR Hub pages; the HR Hub opens its own search. */
export const HUB_SEARCH_EVENT = "csb:hr-search";

/** Whether going from one path to another crosses the HR Hub's edge and so needs a full page load. */
export function crossesHubEdge(from: string, to: string): boolean {
  return isHubPath(from) !== isHubPath(to);
}

export function portalById(id: PortalId): Portal {
  return PORTALS.find((p) => p.id === id)!;
}
