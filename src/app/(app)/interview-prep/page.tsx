import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { businessDetails } from "@/server/business";
import { TitleBar } from "@/components/title-bar";
import { TagText } from "@/components/tag-text";
import { INTERVIEW } from "@/content/interview";
import { CaretDown, ChatCircleText, Info, Lightbulb } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export default async function InterviewPrep({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const refs = [...new Set(INTERVIEW.flatMap((t) => t.policies))];
  const [details, docs] = await Promise.all([
    businessDetails(ctx.organisationId),
    db.policy.findMany({ where: { ref: { in: refs }, OR: [{ organisationId: ctx.organisationId ?? undefined }, { organisationId: null }] }, select: { id: true, ref: true, title: true, organisationId: true } }),
  ]);
  const doc = new Map<string, { id: string; title: string }>();
  for (const d of docs.sort((a, b) => Number(Boolean(a.organisationId)) - Number(Boolean(b.organisationId)))) doc.set(d.ref, d);
  const total = INTERVIEW.reduce((n, t) => n + t.questions.length, 0);
  const open = sp.open === "all";
  return (
    <div>
      <TitleBar title="CQC Registered Manager Interview Preparation" back="/resource-centre" />
      <div className="space-y-3 bg-[#f1f2f5] pb-6 pt-3">
        <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[3px] bg-white px-5 py-4">
          <ChatCircleText size={38} weight="fill" aria-hidden="true" className="text-navy-900" />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] text-slate-900">{total} likely questions across {INTERVIEW.length} subjects, each with a model answer.</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-600"><Info size={14} aria-hidden="true" />Use the model answers as a guide. Inspectors want to hear about your own service, in your own words, with real examples.</p>
          </div>
          <Link href={open ? "/interview-prep" : "/interview-prep?open=all"} className="flex h-[34px] items-center rounded-[4px] border-[1.5px] border-slate-500 bg-white px-4 text-[14px] text-slate-800 no-underline hover:border-navy-900">{open ? "Collapse all" : "Expand all"}</Link>
        </section>

        <div className="space-y-[10px] rounded-[4px] border border-slate-300 bg-white p-[14px]">
          {INTERVIEW.map((t, i) => (
            <details key={t.key} open={open || (!sp.open && i === 0)} className="group rounded-[6px] border border-slate-400 bg-[#eef0f2]" data-testid={`topic-${t.key}`}>
              <summary className="flex min-h-[64px] cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">
                <span className="flex w-[74px] shrink-0 flex-col items-center justify-center self-stretch border-r border-slate-300">
                  <span className="flex h-[32px] w-[32px] items-center justify-center rounded-full border-2 border-teal-500 bg-white text-[13px] text-slate-800">{t.questions.length}</span>
                  <span className="mt-0.5 text-[11px] text-slate-700">Questions</span>
                </span>
                <span className="pl-5 text-[18px] text-slate-800">{t.subject}</span>
                <CaretDown size={20} weight="bold" aria-hidden="true" className="ml-auto mr-6 text-slate-800 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-slate-300 bg-white px-5 py-4">
                <ol className="space-y-5">
                  {t.questions.map((q, n) => (
                    <li key={n}>
                      <p className="flex gap-3 text-[15.5px] font-medium text-navy-900"><span className="font-mono text-[13px] font-normal leading-6 text-teal-600">Q{n + 1}</span><span><TagText text={q.q} details={details} /></span></p>
                      <div className="ml-9 mt-2 rounded-[3px] border-l-[3px] border-teal-400 bg-teal-50 px-4 py-2.5 text-[14.5px] leading-6 text-slate-800">
                        <span className="mb-0.5 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.06em] text-teal-700"><Lightbulb size={14} weight="fill" aria-hidden="true" />Model answer</span>
                        <TagText text={q.a} details={details} />
                      </div>
                    </li>
                  ))}
                </ol>
                {t.policies.some((r) => doc.has(r)) ? (
                  <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-[13px] text-slate-600">
                    Read before your interview:
                    {t.policies.filter((r) => doc.has(r)).map((r) => <Link key={r} href={`/policies/${doc.get(r)!.id}`} className="text-[#1d4f91] no-underline hover:underline">{doc.get(r)!.title}</Link>)}
                  </p>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
