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
    summary: "Short online courses for care staff, with certificates and a live training matrix that shows who is due a refresher.",
    features: ["Courses mapped to the Care Certificate standards", "Automatic reminders before training expires", "Training matrix by person, team and service", "Certificates stored against each staff record"],
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
    summary: "Build person-centred care plans and risk assessments from guided questions, linked to the policies they rely on.",
    features: ["Guided assessment that writes the first draft", "Risk scores that prompt the right assessments", "Review dates and change history for each plan", "Print or share a plan with the person and family"],
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
    summary: "Plan shifts and home care visits around people's needs and staff skills, and spot gaps before they happen.",
    features: ["Drag-and-drop rota with skills matching", "Visit scheduling with travel time", "Gaps and overtime highlighted", "Staff see their rota on their phone"],
  },
  {
    slug: "mock-inspections",
    name: "Mock Inspections & Audit Engine",
    summary: "Run audits and mock inspections against CQC's quality statements, record findings and turn them into tracked actions.",
    features: ["Audit tools for medicines, care plans, IPC and more", "Mock inspection by key question", "Findings become actions with owners and dates", "Results feed your compliance reports"],
    opens: [{ href: "/audits", label: "Audits & inspections" }, { href: "/actions", label: "Actions & risks" }],
  },
];
