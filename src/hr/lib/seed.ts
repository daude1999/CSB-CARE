import type { State, Employee, Check, Doc } from "./domain";
export function seed(): State {
  const branches = [
    { id: "liverpool", org: "csb", name: "Liverpool" },
    { id: "portsmouth", org: "csb", name: "Portsmouth" },
    { id: "tower-hamlets", org: "csb", name: "Tower Hamlets" },
    { id: "other", org: "other", name: "Other organisation" },
  ];
  const users: State["users"] = [
    {
      id: "admin",
      org: "csb",
      name: "Alex Morgan",
      role: "Organisation Admin",
      branches: branches.slice(0, 3).map((b) => b.id),
      sensitive: true,
      active: true,
    },
    {
      id: "group",
      org: "csb",
      name: "Jordan Ellis",
      role: "Group HR",
      branches: branches.slice(0, 3).map((b) => b.id),
      sensitive: true,
      active: true,
    },
    {
      id: "liverpool-hr",
      org: "csb",
      name: "Sam Parker",
      role: "Branch HR",
      branches: ["liverpool"],
      sensitive: true,
      active: true,
    },
    {
      id: "viewer",
      org: "csb",
      name: "Taylor Reed",
      role: "Branch Viewer",
      branches: ["liverpool"],
      sensitive: false,
      active: true,
    },
    {
      id: "other-admin",
      org: "other",
      name: "Isolation fixture",
      role: "Organisation Admin",
      branches: ["other"],
      sensitive: true,
      active: true,
    },
  ];
  const names = [
    "Amelia Hart",
    "Oliver Bennett",
    "Isla Foster",
    "Noah Clarke",
    "Mia Wilson",
    "Leo Hughes",
    "Ava Robinson",
    "Ethan Brooks",
    "Grace Mitchell",
    "Theo Collins",
    "Freya James",
    "Oscar Patel",
    "Lily Edwards",
    "Arthur Woods",
    "Sophie Taylor",
    "Jacob Morris",
    "Evie Walker",
    "Thomas Green",
    "Ella Cooper",
    "Henry Scott",
    "Poppy Adams",
    "Jack Turner",
    "Daisy Hill",
    "George Lewis",
    "Florence Baker",
    "Charlie Young",
    "Alice King",
    "William Wright",
    "Ruby Hall",
    "James Carter",
    "Matilda Allen",
    "Lucas Evans",
    "Rosie Nelson",
    "Benjamin Shaw",
    "Esme Ward",
    "Archie Phillips",
    "Chloe Cox",
    "Daniel Ross",
    "Sienna Bell",
    "Samuel Reed",
    "Emma Price",
    "Harrison Cook",
    "Amelia Hart",
    "Zara Hayes",
    "Adam Grant",
  ];
  const employees: Employee[] = names.map((name, i) => ({
    id: `emp-${i + 1}`,
    org: "csb",
    staffId: `CSB-${String(1001 + i)}`,
    name,
    branch: branches[Math.floor(i / 15)].id,
    job: [
      "Care Support Worker",
      "Senior Support Worker",
      "Care Coordinator",
      "Registered Manager",
      "HR Administrator",
    ][i % 5],
    status: i % 14 === 13 ? "Archived" : i % 7 === 6 ? "Onboarding" : "Active",
    start: `202${2 + (i % 4)}-${String(1 + (i % 9)).padStart(2, "0")}-12`,
    email: `${name.toLowerCase().replaceAll(" ", ".")}.${i + 1}@example.com`,
    phone: "",
    updated: "2026-09-28T09:00:00Z",
    version: 1,
  }));
  employees.push({
    id: "other-emp",
    org: "other",
    staffId: "OTHER-001",
    name: "Isolation Employee",
    branch: "other",
    job: "Coordinator",
    status: "Active",
    start: "2026-01-01",
    email: "isolation@example.com",
    phone: "",
    updated: "2026-09-28T09:00:00Z",
    version: 1,
  });
  const checks: Check[] = [];
  const documents: Doc[] = [];
  employees.forEach((e, i) => {
    ["DBS review", "Right to work", "Safeguarding training"].forEach(
      (name, j) => {
        const n = i * 3 + j;
        const missing = n % 11 === 5;
        const id = `doc-${n}`;
        if (!missing)
          documents.push({
            id,
            org: e.org,
            employee: e.id,
            category: ["DBS", "Right to work", "Training"][j],
            filename: [
              "demo-dbs-review.pdf",
              "demo-right-to-work.pdf",
              "demo-safeguarding.pdf",
            ][j],
            mime: "application/pdf",
            version: 1,
            previous: null,
            uploaded: "2026-09-20T10:00:00Z",
            uploader: "Alex Morgan",
            state: "Sample",
            key: null,
            issueDate: "2026-02-15",
            reviewDate: null,
            expiryDate: null,
            retentionDate: null,
            source: "Fictional seed",
          });
        checks.push({
          id: `check-${n}`,
          org: e.org,
          employee: e.id,
          name,
          required: true,
          recurring: j !== 1,
          due:
            j === 1
              ? null
              : j === 2 && i % 5 !== 0
                ? "2027-03-12"
                : [
                    "2026-09-15",
                    "2026-09-29",
                    "2026-10-06",
                    "2026-10-13",
                    "2026-10-29",
                    "2027-02-15",
                    "2027-05-10",
                    "2027-06-20",
                  ][i % 8],
          verified: n % 9 !== 4,
          evidence: missing ? null : id,
          reviewer: n % 9 !== 4 ? "Alex Morgan" : null,
          checkedAt: n % 9 !== 4 ? "2026-09-20T11:00:00Z" : null,
          version: 1,
          ...(j === 0
            ? {
                issueDate: "2026-02-15",
                certificateRef: "DEMO-REFERENCE",
                checkType: "Enhanced",
                workforce: "Adults",
                updateService: false,
                consent: false,
              }
            : {}),
        });
      },
    );
  });
  const versioned = documents.find(
    (d) => d.employee === "emp-6" && d.category === "Training",
  );
  if (versioned) {
    documents.push({
      ...versioned,
      id: versioned.id + "-previous",
      filename: "demo-training-previous.pdf",
      uploaded: "2026-08-10T10:00:00Z",
    });
    versioned.version = 2;
    versioned.previous = versioned.id + "-previous";
  }
  const events = employees.map((e) => ({
    id: `event-${e.id}`,
    org: e.org,
    employee: e.id,
    actor: "Fictional seed",
    action: "Employee record created in pilot fixture",
    at: e.updated,
  }));
  documents.forEach((d) =>
    events.push({
      id: `event-${d.id}`,
      org: d.org,
      employee: d.employee,
      actor: "Fictional seed",
      action: `Sample ${d.category} evidence added`,
      at: d.uploaded,
    }),
  );
  return {
    branches,
    users,
    employees,
    checks,
    documents,
    events,
    notes: [],
    notices: [],
    imports: [],
    views: [],
    settings: Object.fromEntries(
      ["csb", "other"].map((org) => [
        org,
        {
          thresholds: [30, 14, 7, 0],
          dbsPolicy:
            "Pilot policy: reviewer sets the next organisational review date individually. No universal DBS expiry interval.",
          retention:
            "Live retention policy requires CSB approval. Demo uploads are quarantined and can be reset locally.",
          documentTypes: [
            "DBS",
            "Identity",
            "Right to work",
            "Contracts",
            "References",
            "Training",
            "Qualifications",
            "Other",
          ].map((name) => ({
            name,
            sensitive: ["DBS", "Identity", "Right to work"].includes(name),
          })),
          requirements: [
            {
              id: "dbs",
              name: "DBS review",
              category: "DBS",
              job: "",
              branch: "",
              recurring: true,
              enabled: true,
            },
            {
              id: "rtw",
              name: "Right to work",
              category: "Right to work",
              job: "",
              branch: "",
              recurring: false,
              enabled: true,
            },
            {
              id: "training",
              name: "Safeguarding training",
              category: "Training",
              job: "",
              branch: "",
              recurring: true,
              enabled: true,
            },
          ],
        },
      ]),
    ),
  };
}
