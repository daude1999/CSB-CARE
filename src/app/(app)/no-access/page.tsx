import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { TitleBar } from "@/components/title-bar";
import { PORTALS } from "@/lib/portals";

export const dynamic = "force-dynamic";

const ROLE_NAMES: Record<string, string> = {
  ORG_ADMIN: "Organisation admin",
  POLICY_AUTHOR: "Policy author",
  POLICY_REVIEWER: "Policy reviewer",
  POLICY_APPROVER: "Policy approver",
  COMPLIANCE_LEAD: "Compliance lead",
  STAFF: "Care staff",
};

export default async function NoAccess({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const portal = PORTALS.find((p) => p.id === sp.portal);
  const org = ctx.organisationId ? await db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { name: true } }) : null;
  const roles = ctx.orgRoles.map((r) => ROLE_NAMES[r] ?? r).join(", ") || "no role";
  return (
    <div>
      <TitleBar title="No access" />
      <div className="bg-[#f1f2f5] px-4 py-10">
        <section className="mx-auto max-w-[640px] rounded-[3px] bg-white px-8 py-9 text-center" data-testid="no-access">
          <span aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fde1e3] text-[26px] font-bold text-[#a3242c]">!</span>
          <h2 className="mt-4 font-sans text-[22px] font-medium text-navy-900">You don&apos;t have access to {portal?.name ?? "that portal"}</h2>
          <p className="mt-2 text-[15px] text-slate-600">Your role{org ? ` at ${org.name.replace(/\s+\(DEMO\)$/i, "")}` : ""} is {roles}. Ask your manager if you need this portal.</p>
          <Link href="/overview" className="btn-primary mt-5">Go to Overview</Link>
        </section>
      </div>
    </div>
  );
}
