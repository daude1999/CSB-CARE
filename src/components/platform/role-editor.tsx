"use client";

import { useMemo, useState } from "react";

const ORDER = ["No access", "View", "Create", "Edit", "Manage", "Administrative"];
const LEVEL_CLS: Record<string, string> = {
  "No access": "text-px-faint", View: "bg-px-info-bg text-px-info", Create: "bg-px-ok-bg text-px-ok", Edit: "bg-px-warn-bg text-px-warn", Manage: "bg-px-accent-soft text-px-accent-strong", Administrative: "bg-px-ink text-white",
};

/**
 * Role and branch access for one membership, with a live view of the effective access by module and exactly which
 * permissions the change adds or removes, before saving. The permission map comes from the server's registry, and the
 * server checks everything again when the form is saved: nothing here grants anything.
 */
export function RoleEditor({ roles, branches, selectedRoles, selectedBranches, jobTitle, rolePermissions, idPrefix, catalogue }: {
  roles: [string, string][];
  branches: { id: string; name: string }[];
  selectedRoles: string[];
  selectedBranches: string[];
  jobTitle: string | null;
  rolePermissions: Record<string, string[]>;
  idPrefix: string;
  catalogue?: { groups: readonly string[]; perms: Record<string, { group: string; level: string }> };
}) {
  const [chosen, setChosen] = useState<string[]>(selectedRoles);
  const perms = (rs: string[]) => new Set(rs.flatMap((r) => rolePermissions[r] ?? []));
  const diff = useMemo(() => {
    const a = perms(selectedRoles);
    const b = perms(chosen);
    return { added: [...b].filter((p) => !a.has(p)).sort(), removed: [...a].filter((p) => !b.has(p)).sort() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, selectedRoles, rolePermissions]);
  const levels = (set: Set<string>) => {
    const out = new Map<string, string>();
    if (!catalogue) return out;
    for (const p of set) {
      const info = catalogue.perms[p];
      if (!info) continue;
      const cur = out.get(info.group) ?? "No access";
      if (ORDER.indexOf(info.level) > ORDER.indexOf(cur)) out.set(info.group, info.level);
    }
    return out;
  };
  const before = levels(perms(selectedRoles));
  const after = levels(perms(chosen));
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="label">Roles</legend>
        <div className="divide-y divide-px-row overflow-hidden rounded-[8px] border border-px-line">
          {roles.map(([value, label]) => {
            const on = chosen.includes(value);
            return (
              <label key={value} className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-[13.5px] ${on ? "bg-px-accent-tint" : "bg-white hover:bg-px-field"}`}>
                <input type="checkbox" name="roles" value={value} checked={on} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, value] : c.filter((x) => x !== value)))} />
                <span className={`flex-1 ${on ? "font-medium text-px-ink" : "text-px-body"}`}>{label}</span>
                <span className="text-[12px] tabular-nums text-px-subtle">{(rolePermissions[value] ?? []).length} permissions</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {branches.length ? (
        <fieldset>
          <legend className="label">Branch access <span className="font-normal text-px-muted">(none ticked means every branch)</span></legend>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {branches.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="branchIds" value={b.id} defaultChecked={selectedBranches.includes(b.id)} />{b.name}</label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <label className="block"><span className="label">Job title</span><input id={`${idPrefix}-job`} name="jobTitle" defaultValue={jobTitle ?? ""} maxLength={120} className="input" /></label>
      {catalogue ? (
        <div>
          <p className="label">Effective access by module</p>
          <ul className="divide-y divide-px-row rounded-[8px] border border-px-line text-[13px]">
            {catalogue.groups.map((g) => {
              const was = before.get(g) ?? "No access";
              const now = after.get(g) ?? "No access";
              const changed = was !== now;
              return (
                <li key={g} className={`flex items-center justify-between gap-2 px-3 py-1.5 ${changed ? "bg-px-warn-bg/40" : ""}`}>
                  <span className="text-px-body">{g}</span>
                  <span className="flex items-center gap-1.5">
                    {changed ? <><span className={`rounded-[4px] px-1.5 text-[12px] line-through opacity-60 ${LEVEL_CLS[was]}`}>{was}</span><span aria-hidden="true" className="text-px-subtle">→</span><span className="sr-only">changes to</span></> : null}
                    <span className={`rounded-[4px] px-1.5 text-[12px] font-medium ${LEVEL_CLS[now]}`}>{now}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div aria-live="polite" className="rounded-[8px] border border-px-line bg-px-field p-3 text-[12.5px]">
        {diff.added.length || diff.removed.length ? (
          <>
            <p className="font-medium text-px-ink">Review before saving</p>
            {diff.added.length ? <p className="mt-1 break-words text-px-ok">Adds {diff.added.length}: {diff.added.join(", ")}</p> : null}
            {diff.removed.length ? <p className="mt-1 break-words text-px-danger">Removes {diff.removed.length}: {diff.removed.join(", ")}</p> : null}
          </>
        ) : <p className="text-px-muted">No change to permissions.</p>}
      </div>
    </div>
  );
}
