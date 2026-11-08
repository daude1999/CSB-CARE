/**
 * The modules Evantix licenses to each customer organisation (Platform Admin Centre → Modules & Features).
 * Pure data, shared by the authorisation layer (src/server/auth/rbac.ts) and the Admin Centre screens.
 *
 * A module is switched off for an organisation only by an explicit TenantModuleEntitlement row with enabled = false.
 * No row means on, so every existing customer keeps everything it has today. Switching a module off never deletes its
 * records: the permissions that belong to it simply stop being granted, on the server, on the next request.
 */
export const MODULE_KEYS = [
  "ROTA",
  "SERVICE_USERS",
  "AI_COORDINATOR",
  "HR",
  "POLICY",
  "CQC",
  "RCA",
  "REPORTING",
  "FINANCE",
  "MEDICATION",
  "CARER_PORTAL",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleInfo {
  key: ModuleKey;
  name: string;
  summary: string;
  /** What stops working when it is switched off, shown before the administrator confirms. */
  consequence: string;
  /** Day-to-day care delivery depends on it: switching it off needs the customer's name typed to confirm. */
  critical: boolean;
  /** Limits the Admin Centre can set for this module and the platform enforces. */
  limits?: readonly { key: string; label: string; unit: string }[];
}

export const MODULES: readonly ModuleInfo[] = [
  { key: "ROTA", name: "Rostering & Care Management", summary: "Rota, visits, call monitoring, templates and cover.", consequence: "Office staff can no longer open the rota, visits, call monitoring or rota settings. Visits and history stay in the database.", critical: true },
  { key: "SERVICE_USERS", name: "Service User Management", summary: "Service user records, care plans, risk assessments, documents, body maps, call notes and incidents.", consequence: "Nobody in the organisation can open or change service user records, care plans, risk assessments or incidents. Every record is kept.", critical: true },
  { key: "AI_COORDINATOR", name: "AI Care Coordinator", summary: "Support plan reading, automatic CRM setup and AI usage.", consequence: "Support plans can no longer be uploaded for automatic setup and AI requests are refused for this organisation. Intakes already created are kept.", critical: false, limits: [{ key: "monthlyRequests", label: "AI requests per month", unit: "requests" }, { key: "monthlySpendPence", label: "Estimated AI spend per month", unit: "pence" }] },
  { key: "HR", name: "HR & Workforce", summary: "The HR Hub: people, compliance, documents.", consequence: "The HR Hub closes for everyone in the organisation. Its data is kept unchanged.", critical: true },
  { key: "POLICY", name: "Policy & Compliance", summary: "Policies, regulatory updates, audits, actions, staff sign-off and evidence.", consequence: "The organisation's own policies, audits, actions and evidence can no longer be opened or changed. Published policies and acknowledgements are kept.", critical: true },
  { key: "CQC", name: "CQC Inspection & Evidence", summary: "Internal CQC readiness assessments and evidence.", consequence: "CQC assessments and evidence links can no longer be opened. They are kept.", critical: false },
  { key: "RCA", name: "Root Cause Analysis", summary: "Investigations, findings and reviews.", consequence: "Root cause analyses can no longer be opened or progressed. They are kept.", critical: false },
  { key: "REPORTING", name: "Reporting & Analytics", summary: "Analytics measures, compliance reports and exports.", consequence: "Analytics and report exports are no longer available. Rota reports still follow the rota permission.", critical: false },
  { key: "FINANCE", name: "Finance & Payroll", summary: "Funders, rate cards, timesheets, invoices and pay runs.", consequence: "Finance screens close. Invoices, timesheets and pay runs are kept.", critical: false },
  { key: "MEDICATION", name: "Medication Management", summary: "Medication lists and MAR records (only where the organisation has switched medication on).", consequence: "Medication lists and MAR records can no longer be opened. They are kept.", critical: false },
  { key: "CARER_PORTAL", name: "Carer Portal", summary: "Carers' own visits on their phones.", consequence: "Carers can no longer open their own visits page. Visit records are kept.", critical: false },
];

export function moduleInfo(key: string): ModuleInfo | undefined {
  return MODULES.find((m) => m.key === key);
}

export function isModuleKey(v: string): v is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(v);
}

/**
 * Which module a permission belongs to. Permissions not listed (organisation settings, the staff directory, staff
 * readiness, the AI assistant) are part of every subscription and never switched off.
 */
export function moduleOfPermission(perm: string): ModuleKey | null {
  if (perm === "visit.own") return "CARER_PORTAL";
  const [area] = perm.split(".");
  switch (area) {
    case "rota":
      return "ROTA";
    case "serviceUser":
    case "callNote":
    case "bodyMap":
    case "care":
    case "incident":
      return "SERVICE_USERS";
    case "careIntake":
      return "AI_COORDINATOR";
    case "finance":
      return "FINANCE";
    case "medication":
      return "MEDICATION";
    case "cqc":
      return "CQC";
    case "rca":
      return "RCA";
    case "analytics":
    case "report":
      return "REPORTING";
    case "policy":
    case "impact":
    case "implementation":
    case "audit":
    case "action":
    case "evidence":
    case "risk":
    case "signoff":
      return "POLICY";
    default:
      return null;
  }
}
