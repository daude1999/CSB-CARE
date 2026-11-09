"use client";

import { useMemo, useState } from "react";

/**
 * Role and branch checkboxes with a live review of the access the change gives or takes away, before saving.
 * The permission map comes from the server's registry; the server checks everything again when the form is saved.
 */
export function RoleEditor({ roles, branches, selectedRoles, selectedBranches, jobTitle, rolePermissions, idPrefix }: {
  roles: [string, string][];
  branches: { id: string; name: string }[];
  selectedRoles: string[];
  selectedBranches: string[];
  jobTitle: string | null;
  rolePermissions: Record<string, string[]>;
  idPrefix: string;
}) {
  const [chosen, setChosen] = useState<string[]>(selectedRoles);
  const diff = useMemo(() => {
    const perms = (rs: string[]) => new Set(rs.flatMap((r) => rolePermissions[r] ?? []));
    const a = perms(selectedRoles);
    const b = perms(chosen);
    return { added: [...b].filter((p) => !a.has(p)).sort(), removed: [...a].filter((p) => !b.has(p)).sort() };
  }, [chosen, selectedRoles, rolePermissions]);
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="label">Roles</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {roles.map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-[13.5px]">
              <input type="checkbox" name="roles" value={value} checked={chosen.includes(value)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, value] : c.filter((x) => x !== value)))} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {branches.length ? (
        <fieldset>
          <legend className="label">Branch access <span className="font-normal text-[#5b6478]">(none ticked means every branch)</span></legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {branches.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="branchIds" value={b.id} defaultChecked={selectedBranches.includes(b.id)} />{b.name}</label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <label className="block"><span className="label">Job title</span><input id={`${idPrefix}-job`} name="jobTitle" defaultValue={jobTitle ?? ""} maxLength={120} className="input" /></label>
      <div aria-live="polite" className="rounded-[6px] bg-white p-2 text-[12.5px]">
        {diff.added.length || diff.removed.length ? (
          <>
            <p className="font-medium text-[#26304a]">Review before saving</p>
            {diff.added.length ? <p className="text-[#17663a]">Adds {diff.added.length}: {diff.added.join(", ")}</p> : null}
            {diff.removed.length ? <p className="text-[#a11d2b]">Removes {diff.removed.length}: {diff.removed.join(", ")}</p> : null}
          </>
        ) : <p className="text-[#5b6478]">No change to permissions.</p>}
      </div>
    </div>
  );
}
