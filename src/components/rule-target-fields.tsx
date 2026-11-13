"use client";

import { useState } from "react";

export type RuleScope = "ORG" | "BRANCH" | "WORKS_IN_BRANCH" | "JOB_TITLE" | "ROLE" | "STAFF";

const SCOPES: { value: RuleScope; label: string }[] = [
  { value: "ORG", label: "Everyone in the organisation" },
  { value: "BRANCH", label: "One branch (employed there)" },
  { value: "WORKS_IN_BRANCH", label: "Everyone who works in a branch (incl. staff based elsewhere)" },
  { value: "JOB_TITLE", label: "A job title" },
  { value: "ROLE", label: "A platform role" },
  { value: "STAFF", label: "Named people" },
];

/**
 * "Assign to" and the one field that goes with it. Only the field for the chosen target is shown and sent, so a branch,
 * job title or person picked by mistake can never be ignored while the policy quietly goes to everyone.
 */
export function RuleTargetFields({ branches, jobTitles, roles, staff }: { branches: { id: string; name: string }[]; jobTitles: string[]; roles: readonly string[]; staff: { id: string; displayName: string; jobTitle: string | null }[] }) {
  const [scope, setScope] = useState<RuleScope>("ORG");
  const show = (s: RuleScope[]) => s.includes(scope);
  return (
    <>
      <label className="col-span-2">
        <span className="label">Assign to</span>
        <select name="scope" className="input" value={scope} onChange={(e) => setScope(e.target.value as RuleScope)}>
          {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      {show(["BRANCH", "WORKS_IN_BRANCH"]) ? (
        <label className="col-span-2"><span className="label">Branch</span><select name="branchId" required defaultValue="" className="input"><option value="" disabled>Choose a branch…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      ) : null}
      {show(["JOB_TITLE"]) ? (
        <label className="col-span-2"><span className="label">Job title</span><select name="jobTitle" required defaultValue="" className="input"><option value="" disabled>Choose a job title…</option>{jobTitles.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      ) : null}
      {show(["ROLE"]) ? (
        <label className="col-span-2"><span className="label">Platform role</span><select name="orgRole" required defaultValue="" className="input"><option value="" disabled>Choose a role…</option>{roles.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ").toLowerCase()}</option>)}</select></label>
      ) : null}
      {show(["STAFF"]) ? (
        <label className="col-span-2">
          <span className="label">Named people (hold Ctrl or ⌘ to choose more than one)</span>
          <select name="staffMemberIds" multiple required size={6} className="input">{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName} · {s.jobTitle ?? "No job title"}</option>)}</select>
        </label>
      ) : null}
      {scope === "ORG" ? <p className="col-span-2 text-meta text-slate-600">Everyone in the organisation will be asked to read it.</p> : null}
    </>
  );
}
