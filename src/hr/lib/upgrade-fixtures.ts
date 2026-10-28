import type { State, Requirement } from "./domain";
/** Additive, one-time fictional-fixture enrichment. Never reset edits or imported records. */
function upgradeVersionTwo(s: State): State {
  if ((s.fixtureVersion || 1) >= 2) return s;
  const rules: Requirement[] = [
    {
      id: "pilot-first-aid",
      name: "First aid certificate",
      category: "Training",
      job: "Care Support Worker",
      branch: "",
      recurring: true,
      enabled: true,
    },
    {
      id: "pilot-manual-handling",
      name: "Manual handling training",
      category: "Training",
      job: "Senior Support Worker",
      branch: "",
      recurring: true,
      enabled: true,
    },
    {
      id: "pilot-driving",
      name: "Driving licence check",
      category: "Driving licence",
      job: "Care Coordinator",
      branch: "",
      recurring: true,
      enabled: true,
    },
  ];
  const policy = s.settings.csb;
  if (policy) {
    if (!policy.documentTypes.some((t) => t.name === "Driving licence"))
      policy.documentTypes.push({ name: "Driving licence", sensitive: true });
    for (const r of rules)
      if (!policy.requirements.some((x) => x.id === r.id || x.name === r.name))
        policy.requirements.push(r);
  }
  for (const e of s.employees.filter(
    (e) => e.org === "csb" && /^emp-\d+$/.test(e.id),
  )) {
    const index = Number(e.id.slice(4));
    e.dateOfBirth ??= `${1980 + (index % 19)}-${String(1 + (index % 12)).padStart(2, "0")}-${String(1 + (index % 25)).padStart(2, "0")}`;
    e.employmentType ??= index % 4 === 0 ? "Part-time" : "Full-time";
    e.lineManager ??=
      s.employees.find(
        (x) =>
          x.org === e.org &&
          x.branch === e.branch &&
          x.job === "Registered Manager" &&
          x.id !== e.id,
      )?.name || "Alex Morgan";
    for (const rule of rules) {
      const id = `${rule.id}-${e.id}`;
      if (s.checks.some((c) => c.id === id)) continue;
      const applicable = e.job === rule.job;
      const hasEvidence = applicable && index % 4 !== 1;
      const verified = hasEvidence && index % 7 !== 0;
      const docId = `evidence-${id}`;
      const due = applicable
        ? [
            "2026-09-22",
            "2026-10-03",
            "2026-10-10",
            "2027-05-20",
            "2027-02-08",
          ][index % 5]
        : null;
      if (hasEvidence && !s.documents.some((d) => d.id === docId)) {
        s.documents.push({
          id: docId,
          org: e.org,
          employee: e.id,
          category: rule.category,
          filename: `demo-${rule.name.toLowerCase().replaceAll(" ", "-")}.pdf`,
          mime: "application/pdf",
          version: 1,
          previous: null,
          uploaded: "2026-09-24T10:00:00Z",
          uploader: "Alex Morgan",
          state: "Sample",
          key: null,
          issueDate: "2026-03-01",
          reviewDate: due,
          expiryDate: null,
          retentionDate: null,
          source: "Fictional seed",
        });
        s.events.push({
          id: `event-${docId}`,
          org: e.org,
          employee: e.id,
          actor: "Fictional seed",
          action: `Sample ${rule.name.toLowerCase()} evidence added`,
          at: "2026-09-24T10:00:00Z",
        });
      }
      s.checks.push({
        id,
        org: e.org,
        employee: e.id,
        name: rule.name,
        category: rule.category,
        requirement: rule.id,
        required: applicable,
        recurring: true,
        due,
        verified,
        evidence: hasEvidence ? docId : null,
        reviewer: verified ? "Alex Morgan" : null,
        checkedAt: verified ? "2026-09-24T11:00:00Z" : null,
        version: 1,
      });
    }
  }
  s.fixtureVersion = 2;
  return s;
}

/** Only enrich original demo employees whose entire address is blank. */
function upgradeVersionThree(s: State): State {
  if ((s.fixtureVersion || 1) >= 3) return s;
  upgradeVersionTwo(s);
  const places: Record<string, [string, string, string]> = {
    liverpool: ["Liverpool", "Merseyside", "L1 0ZZ"],
    portsmouth: ["Portsmouth", "Hampshire", "PO1 0ZZ"],
    "tower-hamlets": ["London", "Greater London", "E1 0ZZ"],
  };
  for (const e of s.employees) {
    if (e.org !== "csb" || !/^emp-\d+$/.test(e.id)) continue;
    if (
      [
        e.addressLine1,
        e.addressLine2,
        e.city,
        e.county,
        e.postcode,
        e.country,
      ].some((v) => v?.trim())
    )
      continue;
    const index = Number(e.id.slice(4));
    const [city, county, postcode] = places[e.branch] || [
      "London",
      "Greater London",
      "E1 0ZZ",
    ];
    Object.assign(e, {
      addressLine1: `${10 + index} ${["Example Close", "Demo Gardens", "Sample Avenue"][index % 3]}`,
      addressLine2: "Fictional demo address",
      city,
      county,
      postcode,
      country: "United Kingdom",
      version: e.version + 1,
    });
  }
  s.fixtureVersion = 3;
  return s;
}

/** Richer fictional HR records; never fabricate history or overwrite an entered field. */
export function upgradeFixtures(s: State): State {
  if ((s.fixtureVersion || 1) >= 4) return s;
  upgradeVersionThree(s);
  const settings = s.settings.csb;
  if (
    settings &&
    !settings.documentTypes.some((t) => t.name === "Supervisions & Appraisals")
  )
    settings.documentTypes.push({
      name: "Supervisions & Appraisals",
      sensitive: true,
    });
  const extra = [
    {
      id: "pilot-contract",
      name: "Employment contract",
      category: "Contracts",
    },
    {
      id: "pilot-reference",
      name: "Employment reference",
      category: "References",
    },
  ];
  for (const rule of extra)
    if (settings && !settings.requirements.some((r) => r.name === rule.name))
      settings.requirements.push({
        ...rule,
        job: "",
        branch: "",
        recurring: false,
        enabled: true,
      });
  for (const e of s.employees.filter(
    (e) => e.org === "csb" && /^emp-\d+$/.test(e.id),
  )) {
    const index = Number(e.id.slice(4));
    e.preferredName ??= e.name.split(" ")[0];
    e.department ??=
      e.job === "HR Administrator" ? "People operations" : "Care services";
    if (!e.emergencyName && !e.emergencyPhone && !e.emergencyRelationship) {
      e.emergencyName = "Jordan Example (fictional)";
      e.emergencyRelationship = "Sibling";
      e.emergencyPhone = "07700 900" + String(index).padStart(3, "0");
    }
    for (const r of extra) {
      const rule = settings?.requirements.find((x) => x.name === r.name);
      if (
        !rule ||
        !rule.enabled ||
        (rule.job && rule.job !== e.job) ||
        (rule.branch && rule.branch !== e.branch)
      )
        continue;
      const id = `${r.id}-${e.id}`;
      if (
        s.checks.some(
          (c) => c.id === id || (c.employee === e.id && c.name === r.name),
        )
      )
        continue;
      const hasEvidence = index % (r.id === "pilot-contract" ? 11 : 7) !== 0;
      const docId = "evidence-" + id;
      if (hasEvidence)
        s.documents.push({
          id: docId,
          org: e.org,
          employee: e.id,
          category: r.category,
          filename: `demo-${r.id.slice(6)}-${e.staffId}.pdf`,
          mime: "application/pdf",
          version: 1,
          previous: null,
          uploaded: "2026-09-25T10:00:00Z",
          uploader: "Fictional seed",
          state: "Sample",
          key: null,
          issueDate: null,
          reviewDate: null,
          expiryDate: null,
          retentionDate: null,
          source: "Fictional seed",
        });
      s.checks.push({
        id,
        org: e.org,
        employee: e.id,
        name: r.name,
        category: r.category,
        requirement: rule.id,
        required: true,
        recurring: false,
        due: null,
        evidence: hasEvidence ? docId : null,
        verified: hasEvidence && index % 9 !== 0,
        reviewer: hasEvidence && index % 9 !== 0 ? "Alex Morgan" : null,
        checkedAt:
          hasEvidence && index % 9 !== 0 ? "2026-09-25T11:00:00Z" : null,
        version: 1,
      });
    }
    if (
      index % 5 === 0 &&
      !s.documents.some((d) => d.id === `demo-supervision-${e.id}`)
    )
      s.documents.push({
        id: `demo-supervision-${e.id}`,
        org: e.org,
        employee: e.id,
        category: "Supervisions & Appraisals",
        filename: `demo-supervision-${e.staffId}.pdf`,
        mime: "application/pdf",
        version: 1,
        previous: null,
        uploaded: "2026-09-26T10:00:00Z",
        uploader: "Fictional seed",
        state: "Sample",
        key: null,
        issueDate: null,
        reviewDate: null,
        expiryDate: null,
        retentionDate: null,
        source: "Fictional seed",
      });
  }
  s.tasks ??= [];
  for (const branch of s.branches.filter((b) => b.org === "csb")) {
    const employee = s.employees.find(
      (e) =>
        e.org === "csb" && e.branch === branch.id && e.status === "Onboarding",
    );
    if (!employee) continue;
    const id = "demo-onboarding-" + employee.id;
    if (s.tasks.some((t) => t.id === id)) continue;
    s.tasks.push({
      id,
      org: "csb",
      employee: employee.id,
      branch: branch.id,
      type: "Confirm onboarding details (demo)",
      assignedTo: "admin",
      due: "2026-10-05",
      priority: "Normal",
      status: "Waiting on HR",
      requirement: null,
      document: null,
      version: 1,
      created: "2026-09-29T10:00:00Z",
      updated: "2026-09-29T10:00:00Z",
      createdBy: "admin",
    });
  }
  s.fixtureVersion = 4;
  return s;
}
