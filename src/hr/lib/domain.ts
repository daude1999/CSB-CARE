export type Role =
  "Organisation Admin" | "Group HR" | "Branch HR" | "Branch Viewer";
export type User = {
  id: string;
  org: string;
  name: string;
  role: Role;
  branches: string[];
  sensitive: boolean;
  active: boolean;
};
export type Branch = { id: string; org: string; name: string };
export type Employee = {
  id: string;
  org: string;
  staffId: string;
  name: string;
  branch: string;
  job: string;
  status: "Active" | "Onboarding" | "Archived";
  start: string;
  email: string;
  phone: string;
  updated: string;
  version: number;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  county?: string;
  postcode?: string;
  country?: string;
  dateOfBirth?: string;
  employmentType?: string;
  lineManager?: string;
  preferredName?: string;
  emergencyName?: string;
  emergencyRelationship?: string;
  emergencyPhone?: string;
  identificationType?: string;
  identificationLastFour?: string;
  department?: string;
  leavingDate?: string;
  employmentHistory?: { at: string; actor: string; changes: string[] }[];
};
export type Check = {
  id: string;
  org: string;
  employee: string;
  name: string;
  required: boolean;
  recurring: boolean;
  due: string | null;
  verified: boolean;
  evidence: string | null;
  reviewer: string | null;
  checkedAt: string | null;
  version: number;
  category?: string;
  requirement?: string;
  issueDate?: string;
  certificateRef?: string;
  checkType?: string;
  workforce?: string;
  updateService?: boolean;
  consent?: boolean;
};
export type Doc = {
  id: string;
  org: string;
  employee: string;
  category: string;
  filename: string;
  mime: string;
  version: number;
  previous: string | null;
  uploaded: string;
  uploader: string;
  state: "Sample" | "Quarantined";
  key: string | null;
  issueDate: string | null;
  reviewDate: string | null;
  expiryDate: string | null;
  retentionDate: string | null;
  source: string | null;
};
export type Event = {
  id: string;
  org: string;
  employee: string | null;
  actor: string;
  action: string;
  at: string;
};
export type Note = {
  document?: string;
  id: string;
  org: string;
  employee: string;
  author: string;
  text: string;
  at: string;
};
export type Notice = {
  id: string;
  org: string;
  employee: string;
  check: string;
  recipient: string;
  key: string;
  message: string;
  read: boolean;
  state: "Pending" | "Delivered" | "Cancelled";
  attempts: number;
  due: string;
  version: number;
  at: string;
};
export type ImportRow = {
  staffId: string;
  name: string;
  branch: string;
  job: string;
  status: string;
  start: string;
  email: string;
  error?: string;
};
export type ImportBatch = {
  id: string;
  org: string;
  actor: string;
  rows: ImportRow[];
  state: "Staged" | "Imported";
  at: string;
  count: number;
};
export type View = {
  id: string;
  org: string;
  user: string;
  name: string;
  filters: Record<string, string>;
  columns: string[];
};
export type State = {
  fixtureVersion?: number;
  tasks?: HRTask[];
  branches: Branch[];
  users: User[];
  employees: Employee[];
  checks: Check[];
  documents: Doc[];
  events: Event[];
  notes: Note[];
  notices: Notice[];
  imports: ImportBatch[];
  views: View[];
  settings: Record<string, OrganisationSettings>;
};
export type Requirement = {
  id: string;
  name: string;
  category: string;
  job: string;
  branch: string;
  recurring: boolean;
  enabled: boolean;
};
export type OrganisationSettings = {
  thresholds: number[];
  dbsPolicy: string;
  retention: string;
  documentTypes: { name: string; sensitive: boolean }[];
  requirements: Requirement[];
};
export type ReviewStatus =
  | "Missing evidence"
  | "Awaiting verification"
  | "Incomplete information"
  | "Overdue"
  | "Due soon"
  | "Up to date"
  | "Not applicable";
export const priorities: Record<ReviewStatus, number> = {
  Overdue: 0,
  "Missing evidence": 1,
  "Incomplete information": 2,
  "Awaiting verification": 3,
  "Due soon": 4,
  "Up to date": 5,
  "Not applicable": 6,
};
export function dateDays(date: string, today: string) {
  return Math.round(
    (Date.parse(date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) /
      86400000,
  );
}
// Core checks are seeded without a category; derive one so DBS and Right to
// work are grouped explicitly rather than falling into "Other".
export function checkCategory(c: Pick<Check, "category" | "name">) {
  if (c.category) return c.category;
  if (c.name === "DBS review") return "DBS";
  if (c.name === "Right to work") return "Right to work";
  return "Training";
}
export const checkCategoryOrder = ["DBS", "Right to work"];
export function sortCheckCategories(categories: string[]) {
  const rank = (c: string) => {
    const i = checkCategoryOrder.indexOf(c);
    return i === -1 ? checkCategoryOrder.length : i;
  };
  return [...categories].sort((a, b) => rank(a) - rank(b));
}
export function checkStatus(c: Check, today: string): ReviewStatus {
  if (!c.required) return "Not applicable";
  if (!c.evidence) return "Missing evidence";
  if (!c.verified) return "Awaiting verification";
  if (c.recurring && !c.due) return "Incomplete information";
  if (c.due) {
    const days = dateDays(c.due, today);
    if (days < 0) return "Overdue";
    if (days <= 30) return "Due soon";
  }
  return "Up to date";
}
export function employeeStatus(checks: Check[], today: string) {
  const required = checks.filter((c) => c.required);
  if (!required.length) return "Not assessed";
  return required.every((c) => checkStatus(c, today) === "Up to date")
    ? "Checks up to date"
    : "Attention required";
}
export function permits(user: User, employee: Employee) {
  return (
    user.active &&
    user.org === employee.org &&
    user.branches.includes(employee.branch)
  );
}
export function canEdit(user: User) {
  return user.role !== "Branch Viewer";
}
export function sensitive(category: string, settings?: OrganisationSettings) {
  return settings
    ? settings.documentTypes.find((t) => t.name === category)?.sensitive !==
        false
    : ["DBS", "Identity", "Right to work"].includes(category);
}
export function csvCell(value: string) {
  const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export const categories = [
  "DBS",
  "Identity",
  "Right to work",
  "Contracts",
  "References",
  "Training",
  "Qualifications",
  "Other",
];

export function employeeAddress(e: Employee) {
  return (
    [e.addressLine1, e.addressLine2, e.city, e.county, e.postcode, e.country]
      .filter((v) => v?.trim())
      .join(", ") || "Not recorded"
  );
}

export type HRTask = {
  id: string;
  org: string;
  employee: string;
  branch: string;
  type: string;
  assignedTo: string;
  due: string;
  priority: "Low" | "Normal" | "High";
  status: "Not started" | "Waiting on employee" | "Waiting on HR" | "Complete";
  requirement: string | null;
  document: string | null;
  version: number;
  created: string;
  updated: string;
  createdBy: string;
};
export const privateEmployeeFields = [
  "addressLine1",
  "addressLine2",
  "city",
  "county",
  "postcode",
  "country",
  "dateOfBirth",
  "emergencyName",
  "emergencyRelationship",
  "emergencyPhone",
  "identificationType",
  "identificationLastFour",
] as const;
export function permittedEmployee(e: Employee, user: User): Employee {
  const result = { ...e };
  if (!user.sensitive)
    for (const key of privateEmployeeFields) delete result[key];
  return result;
}
