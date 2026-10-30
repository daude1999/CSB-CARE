/** Add-on modules. Included ones open existing CSB features; locked ones show what is coming and let a customer register interest. */
export type Module = {
  slug: string;
  name: string;
  summary: string;
  features: string[];
  /** Pages that already deliver this module, when it is included. */
  opens?: { href: string; label: string }[];
};

export const MODULES: Module[] = [
  {
    slug: "learning",
    name: "E-Learning & Training Tracking",
    summary: "Training records for care staff, checked by a second person, with a readiness matrix that shows who is due a refresher. Online courses are not built yet.",
    features: ["Training and competency records with second-person verification", "Expiry dates that move staff to \"not ready\" automatically", "Readiness matrix by requirement, role and branch", "Online courses and certificates: not built yet"],
    opens: [{ href: "/rota/readiness", label: "Staff readiness" }, { href: "/admin/readiness", label: "Readiness matrix" }],
  },
  {
    slug: "hr-advice",
    name: "HR & Health and Safety Advice",
    summary: "Templates and guided answers for everyday HR and health and safety questions, with a route to speak to an adviser.",
    features: ["HR letter and contract templates", "Guided flows for absence, conduct and grievance", "Health and safety risk assessment library", "Request a call back from an adviser"],
  },
  {
    slug: "care-plans",
    name: "Risk Assessments & Care Plan Builder",
    summary: "Versioned care plans and risk assessments for each person, approved by a second person and confirmed by carers. Guided drafting is not built yet.",
    features: ["Care plans with sections, versions and second-person approval", "Risk register with review dates and history", "Carers confirm they have read the current plan", "Guided first drafts and sharing with families: not built yet"],
    opens: [{ href: "/rota/care-plans", label: "Care plans" }, { href: "/rota/risks", label: "Risk assessments" }],
  },
  {
    slug: "read-tracking",
    name: "Staff Policy Read-Tracking & Sign Audit Logs",
    summary: "Send policies to staff, see who has read and signed them, chase anyone overdue and export the audit trail for inspection.",
    features: ["Read & sign from any policy page", "Overdue reminders sent automatically", "Sign-off status by policy and by person", "Full audit trail of who did what and when"],
    opens: [{ href: "/acknowledgements", label: "My reading list" }, { href: "/staff", label: "Staff sign-off status" }, { href: "/reports", label: "Reports" }],
  },
  {
    slug: "rotas",
    name: "Rotas & Scheduling",
    summary: "Plan home care visits around people's needs and staff readiness, monitor calls live and prepare timesheets and invoices.",
    features: ["Templates, Build Rota and a drag-and-drop planner with eligibility checks", "Live call monitoring and an exceptions register", "Carers clock in, record tasks and write notes on their phone", "Travel time and route optimisation: not built yet"],
    opens: [{ href: "/rota", label: "Rota dashboard" }, { href: "/rota/visits", label: "Daily visits" }, { href: "/rota/monitor", label: "The Monitor" }],
  },
  {
    slug: "mock-inspections",
    name: "Mock Inspections & Audit Engine",
    summary: "Run audits and mock inspections against CQC's quality statements, record findings and turn them into tracked actions.",
    features: ["Audit tools for medicines, care plans, IPC and more", "Mock inspection by key question", "Findings become actions with owners and dates", "Results feed your compliance reports"],
    opens: [{ href: "/audits", label: "Audits & inspections" }, { href: "/actions", label: "Actions & risks" }],
  },
];
