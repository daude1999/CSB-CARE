import { notFound } from "next/navigation";
import Link from "@/components/link";
import type { ReadinessRequirement, ReadinessScope } from "@prisma/client";
import { db } from "@/lib/db";
import { londonDate } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listRequirements } from "@/server/readiness";
import { rotaSettings } from "@/server/rota/settings";
import { suName } from "@/server/rota/queries";
import { retireRequirementAction, saveRequirementAction } from "@/app/readiness-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const CATEGORY: Record<string, string> = { TRAINING: "Training", COMPETENCY: "Competency", POLICY: "Policy acknowledgement", QUALIFICATION: "Qualification" };
const CLASSIFICATION: Record<string, string> = { MANDATORY_ROLE: "Mandatory for the role", AGENCY_POLICY: "Agency policy", CONTRACT: "Contract requirement", RECOMMENDED: "Recommended" };

/**
 * The staff readiness matrix: what each role, branch, care task or service user requires. Changing a requirement
 * creates a new version and retires the old one, so evidence and history keep their meaning; everyone it applies to is
 * flagged for review.
 */
export default async function ReadinessMatrixPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("admin");
  if (!hasOrgPermission(ctx, "readiness.manage")) notFound();
  const org = ctx.organisationId!;
  const showRetired = sp.retired === "1";
  const [requirements, settings, branches, careTasks, serviceUsers, policies] = await Promise.all([
    listRequirements(ctx, { includeRetired: showRetired }),
    rotaSettings(db, org),
    db.branch.findMany({ where: { organisationId: org }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.careTask.findMany({ where: { organisationId: org, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.serviceUser.findMany({ where: { organisationId: org, status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true, firstName: true, lastName: true, preferredName: true }, orderBy: { lastName: "asc" }, take: 500 }),
    db.policy.findMany({ where: { organisationId: org, status: "ACTIVE" }, select: { id: true, ref: true, title: true }, orderBy: { ref: "asc" } }),
  ]);
  const names = {
    branch: new Map(branches.map((b) => [b.id, b.name])),
    task: new Map(careTasks.map((t) => [t.id, t.name])),
    su: new Map(serviceUsers.map((u) => [u.id, suName(u)])),
    policy: new Map(policies.map((p) => [p.id, `${p.ref} ${p.title}`])),
  };
  const scopeText = (s: ReadinessScope) =>
    s.kind === "ALL" ? "Everyone" : s.kind === "JOB_TITLE" ? s.jobTitle : s.kind === "BRANCH" ? `Branch: ${names.branch.get(s.branchId ?? "") ?? "removed"}` : s.kind === "CARE_TASK" ? `Task: ${names.task.get(s.careTaskId ?? "") ?? "removed"}` : `Person: ${names.su.get(s.serviceUserId ?? "") ?? "not in list"}`;
  const editing = sp.edit ? requirements.find((r) => r.id === sp.edit && r.status === "ACTIVE") : undefined;
  const back = "/admin/readiness";

  return (
    <>
      <PageHeader title="Staff Readiness Matrix" back="/settings" subtitle="What each role, branch, care task or service user requires before someone may work. Hard stops block allocation and clock-in when not met; advisory ones are flagged for review. Classifications and renewal periods are starting points for your compliance lead to confirm, not legal advice." actions={<><Link href="/rota/readiness" className="btn-secondary">Readiness queue</Link><Link href={showRetired ? back : `${back}?retired=1`} className="btn-secondary">{showRetired ? "Hide retired versions" : "Show retired versions"}</Link></>} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card>
          {requirements.length ? (
            <table className="table">
              <thead><tr><th>Requirement</th><th>Type</th><th>Applies to</th><th>Renewal</th><th>If not met</th><th>Evidence held</th><th /></tr></thead>
              <tbody>
                {requirements.map((r) => (
                  <tr key={r.id} className={r.status === "RETIRED" ? "text-slate-500" : ""}>
                    <td>
                      <span className="font-medium">{r.name}</span> <span className="text-[12px] text-slate-500">v{r.version}</span>
                      {r.status === "RETIRED" ? <> <Badge>Retired{r.effectiveTo ? ` ${fmtDate(r.effectiveTo)}` : ""}</Badge></> : null}
                      <span className="block text-[12px] text-slate-500">{CLASSIFICATION[r.classification]}{r.sourceAuthority ? ` · ${r.sourceAuthority}` : ""}{r.policyId ? ` · ${names.policy.get(r.policyId) ?? "policy"}` : ""}</span>
                    </td>
                    <td>{CATEGORY[r.category]}{r.requiresPractical && r.category !== "COMPETENCY" ? <span className="block text-[12px] text-slate-500">+ observed competency</span> : null}</td>
                    <td className="text-[13px]">{r.scopes.map(scopeText).join(", ")}</td>
                    <td>{r.renewalMonths ? `${r.renewalMonths} months` : "No renewal"}</td>
                    <td>{r.hardStop ? <Badge tone="rose">Blocks</Badge> : <Badge tone="amber">Review</Badge>}{r.exceptionAllowed ? null : <span className="block text-[12px] text-slate-500">No exceptions</span>}</td>
                    <td className="tabular-nums">{r._count.records} records · {r._count.assessments} assessments</td>
                    <td className="whitespace-nowrap">
                      {r.status === "ACTIVE" ? (
                        <>
                          <Link href={`${back}?edit=${r.id}`} className="btn-secondary py-1 text-[13px]">New version</Link>
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[13px] text-[#0646b1]">Retire</summary>
                            <form action={retireRequirementAction} className="mt-1 flex gap-1">
                              <input type="hidden" name="back" value={back} />
                              <input type="hidden" name="requirementId" value={r.id} />
                              <input name="reason" required minLength={3} className="input w-40 py-1 text-[13px]" placeholder="Why" aria-label={`Why ${r.name} is retired`} />
                              <button className="btn-secondary py-1 text-[13px]">Retire</button>
                            </form>
                          </details>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No requirements yet. Add the first one, for example safeguarding training for care roles.</Empty>}
        </Card>
        <RequirementForm key={editing?.id ?? "new"} editing={editing} back={back} roles={settings.careRoleTitles} branches={branches} careTasks={careTasks} serviceUsers={serviceUsers.map((u) => ({ id: u.id, name: suName(u) }))} policies={policies} />
      </div>
    </>
  );
}

function RequirementForm({ editing, back, roles, branches, careTasks, serviceUsers, policies }: {
  editing?: ReadinessRequirement & { scopes: ReadinessScope[] };
  back: string;
  roles: string[];
  branches: { id: string; name: string }[];
  careTasks: { id: string; name: string }[];
  serviceUsers: { id: string; name: string }[];
  policies: { id: string; ref: string; title: string }[];
}) {
  const e = editing;
  const has = (kind: string, v?: string | null) => Boolean(e?.scopes.some((s) => s.kind === kind && (v === undefined || s.jobTitle === v || s.branchId === v || s.careTaskId === v || s.serviceUserId === v)));
  const otherTitles = e?.scopes.filter((s) => s.kind === "JOB_TITLE" && s.jobTitle && !roles.includes(s.jobTitle)).map((s) => s.jobTitle).join(", ") ?? "";
  return (
    <Card title={e ? `New version of “${e.name}”` : "Add a requirement"} actions={e ? <Link href={back} className="btn-secondary py-1 text-[13px]">Cancel</Link> : null}>
      <form action={saveRequirementAction} className="grid grid-cols-2 gap-2">
        <input type="hidden" name="back" value={e ? `${back}?edit=${e.id}` : back} />
        {e ? <input type="hidden" name="requirementId" value={e.id} /> : null}
        <label className="col-span-2"><span className="label">Name</span><input name="name" required defaultValue={e?.name} className="input" /></label>
        <label><span className="label">Key</span><input name="key" required defaultValue={e?.key} readOnly={Boolean(e)} pattern="[a-z0-9-]+" className="input" placeholder="e.g. safeguarding-adults" /></label>
        <label><span className="label">Type</span><select name="category" defaultValue={e?.category ?? "TRAINING"} className="input">{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span className="label">Classification</span><select name="classification" defaultValue={e?.classification ?? "MANDATORY_ROLE"} className="input">{Object.entries(CLASSIFICATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span className="label">Takes effect</span><input type="date" name="effectiveFrom" required defaultValue={londonDate()} className="input" /></label>
        <label><span className="label">Renewal (months)</span><input type="number" name="renewalMonths" min={1} max={120} defaultValue={e?.renewalMonths ?? ""} className="input" /></label>
        <label><span className="label">Warn this many days before</span><input type="number" name="warningDays" min={0} max={365} defaultValue={e?.warningDays ?? 30} className="input" /></label>
        <label className="col-span-2"><span className="label">Policy to acknowledge (policy requirements only)</span><select name="policyId" defaultValue={e?.policyId ?? ""} className="input"><option value="">—</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.ref} {p.title}</option>)}</select></label>
        <label className="col-span-2"><span className="label">Source authority</span><input name="sourceAuthority" defaultValue={e?.sourceAuthority ?? ""} className="input" placeholder="e.g. Skills for Care" /></label>
        <label className="col-span-2"><span className="label">Description</span><textarea name="description" rows={2} defaultValue={e?.description ?? ""} className="input" /></label>
        <fieldset className="col-span-2 space-y-1">
          <legend className="label">Rules</legend>
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="hardStop" defaultChecked={e?.hardStop ?? true} className="h-4 w-4" /> Not met blocks allocation and clock-in (otherwise flagged for review)</label>
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="requiresPractical" defaultChecked={e?.requiresPractical ?? false} className="h-4 w-4" /> Needs an observed competency assessment as well as the course</label>
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="exceptionAllowed" defaultChecked={e?.exceptionAllowed ?? true} className="h-4 w-4" /> A manager may grant a time-limited exception</label>
        </fieldset>
        <fieldset className="col-span-2 space-y-1.5">
          <legend className="label">Applies to (any match applies)</legend>
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="scopeAll" defaultChecked={has("ALL")} className="h-4 w-4" /> Everyone</label>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{roles.map((t) => <label key={t} className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="jobTitles" value={t} defaultChecked={e ? has("JOB_TITLE", t) : true} className="h-4 w-4" /> {t}</label>)}</div>
          <label className="block"><span className="label">Other job titles (comma separated)</span><input name="otherJobTitles" defaultValue={otherTitles} className="input" /></label>
          {branches.length ? <div><span className="label">Branches</span><div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{branches.map((b) => <label key={b.id} className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="branchIds" value={b.id} defaultChecked={has("BRANCH", b.id)} className="h-4 w-4" /> {b.name}</label>)}</div></div> : null}
          {careTasks.length ? <div><span className="label">Only for visits with these care tasks</span><div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{careTasks.map((t) => <label key={t.id} className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="careTaskIds" value={t.id} defaultChecked={has("CARE_TASK", t.id)} className="h-4 w-4" /> {t.name}</label>)}</div></div> : null}
          <label className="block"><span className="label">Only for visits to these people</span><select name="serviceUserIds" multiple size={4} defaultValue={e?.scopes.filter((s) => s.kind === "SERVICE_USER" && s.serviceUserId).map((s) => s.serviceUserId as string) ?? []} className="input">{serviceUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <p className="text-[12.5px] text-slate-500">Task and person scopes only bite on visits that involve that task or person.</p>
        </fieldset>
        <div className="col-span-2"><button className="btn-primary">{e ? "Save new version" : "Add requirement"}</button>{e ? <span className="ml-2 text-[13px] text-slate-500">Everyone it applies to is flagged for review.</span> : null}</div>
      </form>
    </Card>
  );
}
