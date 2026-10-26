import Link from "@/components/link";
import { db } from "@/lib/db";
import { POLICY_AREAS } from "@/lib/policy-areas";
import type { Ctx } from "@/server/auth/rbac";
import { Bank, CaretDown, CaretLeft, ClipboardText, FirstAidKit, HouseLine, IdentificationBadge, LockKey, Pill, Shield, Stethoscope } from "@phosphor-icons/react/dist/ssr";
import { DOC_TYPES } from "../../../../prisma/seed-data/library/types";

const ICONS: Record<string, React.ReactNode> = {
  governance: <Bank size={32} weight="fill" />,
  safeguarding: <Shield size={32} weight="fill" />,
  care: <ClipboardText size={32} weight="fill" />,
  clinical: <Stethoscope size={32} weight="bold" />,
  medicines: <Pill size={32} weight="fill" />,
  "health-safety": <FirstAidKit size={32} weight="fill" />,
  people: <IdentificationBadge size={32} weight="fill" />,
  information: <LockKey size={32} weight="fill" />,
  services: <HouseLine size={32} weight="fill" />,
};

const typeName = new Map<string, string>(DOC_TYPES);
const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Europe/London" }).replace(/ (\d\d)$/, " '$1");

/** My Policies by area: a tab per area of care, then a row per category that opens to list its documents. */
export async function PolicyAreas({ ctx, area }: { ctx: Ctx; area?: string }) {
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const [policies, categories] = await Promise.all([
    db.policy.findMany({
      where: { organisationId: ctx.organisationId, status: "ACTIVE" },
      orderBy: { title: "asc" },
      select: { id: true, ref: true, title: true, docType: true, categoryCode: true, publications: { where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 1, select: { publishedAt: true } } },
    }),
    db.policyCategory.findMany(),
  ]);
  const categoryName = new Map(categories.map((c) => [c.code, c.name]));
  const rows = policies.map((p) => {
    const at = p.publications[0]?.publishedAt ?? null;
    return { ...p, updatedAt: at, recent: Boolean(at && at >= monthAgo) };
  });
  const byCategory = new Map<string, typeof rows>();
  for (const r of rows) byCategory.set(r.categoryCode, [...(byCategory.get(r.categoryCode) ?? []), r]);
  const updates = (codes: readonly string[]) => codes.reduce((n, c) => n + (byCategory.get(c)?.filter((r) => r.recent).length ?? 0), 0);
  const active = POLICY_AREAS.find((a) => a.key === area) ?? POLICY_AREAS[0];
  const groups = active.categories.filter((c) => byCategory.has(c));

  return (
    <div>
      <div className="relative flex h-[60px] items-center justify-center rounded-t-[6px] bg-navy-900 px-4 text-white">
        <Link href="/" className="absolute left-4 flex items-center gap-2 text-[15px] text-white no-underline hover:text-teal-200"><CaretLeft size={14} weight="bold" aria-hidden="true" />Back</Link>
        <h1 className="text-[20px] font-medium tracking-normal text-white">My Policies</h1>
      </div>
      <div className="flex justify-end pt-2">
        <Link href="/policies?view=index" className="flex h-[34px] items-center rounded-[4px] border-[1.5px] border-slate-500 bg-white px-5 text-[15px] text-slate-800 no-underline hover:border-navy-900">Policy Index</Link>
      </div>

      <nav aria-label="Policy areas" className="mt-3 flex flex-wrap gap-[6px] px-2">
        {POLICY_AREAS.map((a) => {
          const n = updates(a.categories);
          const on = a.key === active.key;
          return (
            <Link key={a.key} href={`/policies?area=${a.key}`} aria-current={on ? "page" : undefined} className={`relative flex h-[84px] w-[103px] flex-col items-center justify-center gap-1 rounded-t-[4px] border border-b-0 text-center no-underline ${on ? "z-10 -mb-px border-slate-300 bg-white pb-px" : "border-slate-200 bg-white hover:bg-teal-50"}`}>
              <span aria-hidden="true" className="text-navy-900">{ICONS[a.key]}</span>
              <span className={`px-1 text-[13.5px] leading-[1.15] text-navy-900 ${on ? "font-semibold" : ""}`}>{a.label}</span>
              {n ? <span className="absolute -right-2 -top-2 flex h-[24px] min-w-[24px] items-center justify-center rounded-full bg-[#f06a4d] px-1 text-[12px] font-medium text-white">{n}<span className="sr-only"> updates</span></span> : null}
            </Link>
          );
        })}
      </nav>

      <section aria-label={active.label} className="space-y-[12px] rounded-[4px] border border-slate-300 bg-white p-[14px]">
        {groups.length ? groups.map((code) => {
          const docs = byCategory.get(code)!;
          const n = docs.filter((d) => d.recent).length;
          return (
            <details key={code} className="group rounded-[6px] border border-slate-400 bg-[#eef0f2]">
              <summary className="flex h-[78px] cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">
                <span className="flex w-[74px] shrink-0 flex-col items-center justify-center self-stretch border-r border-slate-300">
                  <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full border-2 border-[#f0a92e] bg-white text-[13px] text-slate-800">{n}</span>
                  <span className="mt-0.5 text-[11.5px] text-slate-700">Updates</span>
                </span>
                <span className="pl-5 text-[19px] text-slate-800">{categoryName.get(code)}</span>
                <span className="ml-auto pl-2 text-[13px] text-slate-500">{docs.length} {docs.length === 1 ? "document" : "documents"}</span>
                <CaretDown size={20} weight="bold" aria-hidden="true" className="ml-5 mr-6 text-slate-800 transition-transform group-open:rotate-180" />
              </summary>
              <ul className="border-t border-slate-300 bg-white">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-4 border-b border-slate-200 px-5 py-2.5 text-[14px] last:border-b-0">
                    <span className="w-[70px] shrink-0 text-slate-600">{d.ref.replace(/^CSB-/, "")}</span>
                    <Link href={`/policies/${d.id}`} className="min-w-0 flex-1 font-medium text-[#1d4f91] no-underline hover:underline">{d.title}</Link>
                    <span className="hidden w-[130px] shrink-0 text-slate-600 sm:block">{typeName.get(d.docType) ?? d.docType}</span>
                    <span className="w-[80px] shrink-0 text-slate-600">{d.updatedAt ? fmt(d.updatedAt) : "—"}</span>
                    {d.recent ? <span className="w-[64px] shrink-0 rounded-full bg-[#fdf0d8] px-2 py-0.5 text-center text-[11.5px] text-[#8a5a00]">Updated</span> : <span className="w-[64px] shrink-0" />}
                  </li>
                ))}
              </ul>
            </details>
          );
        }) : <p className="p-6 text-center text-[15px] text-slate-600">You have no policies in this area yet. <Link href="/policies?tab=templates">Browse the template library</Link>.</p>}
      </section>
    </div>
  );
}
