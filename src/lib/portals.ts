/**
 * The portals of the CSB All in One Platform. Each portal is a real set of routes with its own side menu.
 * A portal that is not built yet has `planned` set; it opens an honest "not built yet" page and never shows figures.
 * Which portals a person may open is decided on the server by `portalsFor` in src/server/auth/portals.ts.
 */
export type PortalId = "overview" | "service-users" | "policy" | "rota" | "hr" | "reporting" | "admin";

export interface Portal {
  id: PortalId;
  name: string;
  code: string;
  summary: string;
  /** Where the portal opens. */
  home: string;
  /** The stage that builds a planned portal, shown on its label. */
  planned?: string;
  /** Portals with their own look (the HR Hub) are opened with a full page load so their styles never mix. */
  separateApp?: boolean;
  /** The module colour: the sidebar marker, the portal's page headers and its Overview tile. White text on it meets WCAG AA. */
  colour: string;
  /** A light tint of the module colour for panels behind figures. */
  tint: string;
}

export const PORTALS: readonly Portal[] = [
  { id: "overview", name: "Overview", code: "OV", summary: "Today across every portal", home: "/overview", colour: "#0e7490", tint: "#e6f6fa" },
  { id: "service-users", name: "Service Users", code: "SU", summary: "People you support, care plans, contacts", home: "/service-users", planned: "Stage D", colour: "#b45309", tint: "#fdf1e4" },
  { id: "policy", name: "Policy & Compliance", code: "PC", summary: "Policies, regulatory updates, audits, actions", home: "/", colour: "#1f5fd1", tint: "#eaf1fd" },
  { id: "rota", name: "Rota & Visits", code: "RV", summary: "Weekly rota, visits, call monitoring", home: "/rota", planned: "Stage D", colour: "#6b46c9", tint: "#f1ecfc" },
  { id: "hr", name: "HR & Workforce", code: "HR", summary: "Your HR Hub: people, compliance, documents", home: "/hr/dashboard", separateApp: true, colour: "#c92a54", tint: "#fdebef" },
  { id: "reporting", name: "Reporting & Analytics", code: "RA", summary: "Reports and the AI assistant", home: "/reports", colour: "#0b6f99", tint: "#e5f4fa" },
  { id: "admin", name: "Administration", code: "AD", summary: "Settings, users, sources, jobs", home: "/settings", colour: "#4b5666", tint: "#eef0f3" },
];

/** Planned pieces that are not portals of their own, listed under "Coming later". */
export const COMING_LATER = [{ code: "CW", name: "Carer phone page", summary: "Today's visits, check in and out", planned: "Stage D" }] as const;

const PREFIXES: [string, PortalId][] = [
  ["/overview", "overview"],
  ["/service-users", "service-users"],
  ["/rota", "rota"],
  ["/hr", "hr"],
  ["/reports", "reporting"],
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

export function portalById(id: PortalId): Portal {
  return PORTALS.find((p) => p.id === id)!;
}
