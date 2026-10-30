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
  /** The module colour: the sidebar marker, the portal's page headers and its Overview tile. White text on it meets WCAG AA. */
  colour: string;
  /** A light tint of the module colour for panels behind figures. */
  tint: string;
}

export const PORTALS: readonly Portal[] = [
  { id: "overview", name: "Overview", code: "OV", summary: "Today across every portal", home: "/overview", colour: "#1565c0", tint: "#e8f1fc" },
  { id: "policy", name: "Policy & Compliance", code: "PC", summary: "Policies, regulatory updates, audits, actions", home: "/", colour: "#1f5fd1", tint: "#eaf1fd" },
  { id: "rota", name: "Rostering & Care Management", code: "RC", summary: "Service users, rota, visits, call monitoring, care records, finance", home: "/rota", colour: "#6b46c9", tint: "#f1ecfc" },
  { id: "hr", name: "HR & Workforce", code: "HR", summary: "Your HR Hub: people, compliance, documents", home: "/hr/dashboard", colour: "#c2410c", tint: "#fff1e6" },
  { id: "reporting", name: "Reporting & Analytics", code: "RA", summary: "Measures, reports and the AI assistant", home: "/analytics", colour: "#0b6f99", tint: "#e5f4fa" },
  { id: "admin", name: "Administration & Settings", code: "AD", summary: "Settings, users, sources, jobs", home: "/settings", colour: "#4b5666", tint: "#eef0f3" },
];


const PREFIXES: [string, PortalId][] = [
  ["/overview", "overview"],
  // Service users and call monitoring are part of Rostering & Care Management; /service-users redirects there.
  ["/service-users", "rota"],
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
