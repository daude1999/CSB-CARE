import { randomUUID } from "node:crypto";
import type { State, Employee } from "./domain";
/** Reconcile applicability without deleting evidence or past review decisions. */
export function applyRequirements(s: State, e: Employee) {
  const rules = s.settings[e.org].requirements;
  for (const r of rules) {
    const applicable =
      r.enabled &&
      (!r.job || r.job === e.job) &&
      (!r.branch || r.branch === e.branch);
    const existing = s.checks.find(
      (c) =>
        c.employee === e.id &&
        (c.requirement === r.id || (!c.requirement && c.name === r.name)),
    );
    if (existing) {
      if (
        existing.required !== applicable ||
        existing.recurring !== r.recurring ||
        existing.category !== r.category
      )
        existing.version++;
      if (
        existing.evidence &&
        s.documents.find((d) => d.id === existing.evidence)?.category !==
          r.category
      ) {
        existing.evidence = null;
        existing.verified = false;
        existing.reviewer = null;
        existing.checkedAt = null;
      }
      Object.assign(existing, {
        name: r.name,
        required: applicable,
        recurring: r.recurring,
        category: r.category,
        requirement: r.id,
      });
    } else if (applicable) {
      s.checks.push({
        id: randomUUID(),
        org: e.org,
        employee: e.id,
        name: r.name,
        category: r.category,
        requirement: r.id,
        required: true,
        recurring: r.recurring,
        due: null,
        verified: false,
        evidence: null,
        reviewer: null,
        checkedAt: null,
        version: 1,
      });
    }
  }
}
