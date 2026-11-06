import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { getAiProvider } from "@/server/ai";
import { updateBusinessDetailsAction } from "../../actions";
import { Card, Field, Flash } from "@/components/ui";
import { SettingsDirectory } from "@/components/settings-directory";
import { TitleBar } from "@/components/title-bar";
import { BusinessForm } from "@/components/business-form";
import { businessDetails } from "@/server/business";
import { missingDetails } from "@/lib/business";
import { Buildings, CheckCircle, Warning } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("admin");
  if (!hasOrgPermission(ctx, "org.manage")) notFound();
  const org = await db.organisation.findUniqueOrThrow({ where: { id: ctx.organisationId! }, include: { branches: { include: { services: { include: { serviceType: true } } } } } });
  const ai = getAiProvider();
  const details = (await businessDetails(org.id))!;
  const missing = missingDetails(details);
  return (
    <>
      <TitleBar title="Settings" back="/" />
      <div className="bg-[#f1f2f5] px-0 pb-6 pt-3">
      <Flash searchParams={sp} />
      <SettingsDirectory ctx={ctx} />
      <section id="business" aria-labelledby="business-heading" className="mb-4 scroll-mt-24 rounded-[3px] bg-white px-5 pb-5 pt-4">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 pb-3">
          <Buildings size={26} weight="fill" aria-hidden="true" className="text-navy-900" />
          <div className="min-w-0 flex-1">
            <h2 id="business-heading" className="text-[19px] font-normal tracking-normal text-slate-800">Business details</h2>
            <p className="text-[13px] text-slate-600">Recorded once, used everywhere. These details fill the highlighted tags in every policy, form and Word or PDF download.</p>
          </div>
          {missing.length ? (
            <span className="flex items-center gap-1.5 rounded-full bg-[#fde1e3] px-3 py-1 text-[13px] text-[#a3242c]"><Warning size={15} weight="fill" aria-hidden="true" />{missing.length} required {missing.length === 1 ? "detail" : "details"} missing</span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[13px] text-emerald-800"><CheckCircle size={15} weight="fill" aria-hidden="true" />Policies fully personalised</span>
          )}
        </div>
        <BusinessForm initial={details} action={updateBusinessDetailsAction} />
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <div id="publishing-rules" className="scroll-mt-24">
        <Card title="Policy publishing">
          <div className="space-y-2 text-sm text-slate-700" data-testid="publishing-rules">
            <p>Organisation administrators and policy approvers publish your documents directly. No second approval is needed. Policy authors can write and save drafts.</p>
            <p>CSB central policies, procedures, forms and templates reach your library automatically when CSB publishes them. Your local sections are never overwritten.</p>
            <p className="text-xs text-slate-500">Staff reading and sign-off is separate from publishing: set it when you publish, and track it in Staff Sign-off.</p>
          </div>
        </Card>
        </div>
        <Card title="Services">
          <ul className="space-y-2 text-sm">
            {org.branches.map((b) => <li key={b.id}><strong>{b.name}</strong><div className="text-xs text-slate-500">{b.services.map((s) => s.serviceType.name).join(", ") || "No services recorded"}{b.cqcLocationId ? ` · CQC location ${b.cqcLocationId}` : ""}</div></li>)}
          </ul>
        </Card>
        <Card title="Platform configuration">
          <div className="grid grid-cols-1 gap-2">
            <Field label="AI provider">{ai ? `${ai.name}${ai.isSimulated ? " (simulated)" : ""}` : "Not configured"}</Field>
          </div>
        </Card>
      </div>
      </div>
    </>
  );
}
