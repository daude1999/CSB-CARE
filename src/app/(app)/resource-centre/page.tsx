import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { toggleRegistrationItemAction } from "../../actions";
import { Flash } from "@/components/ui";
import { TitleBar } from "@/components/title-bar";
import { CQC_REGISTRATION_URL, PACK, STEPS, TEMPLATES, VIDEOS } from "@/content/registration";
import { ArrowSquareOut, CheckSquare, ChatsCircle, FileDoc, FilePdf, MagnifyingGlass, Play, Square } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

const TONES = {
  navy: "bg-navy-900 [--accent:theme(colors.teal.400)]",
  teal: "bg-teal-600 [--accent:theme(colors.navy.900)]",
  amber: "bg-[#c97a1c] [--accent:theme(colors.navy.900)]",
  rose: "bg-[#b3405a] [--accent:theme(colors.navy.900)]",
};

export default async function ResourceCentre({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const q = (sp.q ?? "").trim().toLowerCase();
  const org = ctx.organisationId ? await db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { settings: true } }) : null;
  const done = new Set(((org?.settings ?? {}) as { registrationPack?: string[] }).registrationPack ?? []);
  const refs = PACK.flatMap((i) => i.csb?.map((c) => c.ref) ?? []);
  const docs = await db.policy.findMany({ where: { ref: { in: refs }, OR: [{ organisationId: ctx.organisationId ?? undefined }, { organisationId: null }] }, select: { id: true, ref: true, organisationId: true } });
  // Prefer the organisation's own copy, then the CSB template.
  const docId = new Map<string, string>();
  for (const d of docs.sort((a, b) => Number(Boolean(a.organisationId)) - Number(Boolean(b.organisationId)))) docId.set(d.ref, d.id);
  const match = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
  const videos = VIDEOS.filter((v) => match(v.title, v.summary));
  const pack = PACK.filter((i) => match(i.document, i.why, ...(i.csb?.map((c) => c.label) ?? [])));
  const plan = TEMPLATES["business-plan"];
  const complete = PACK.filter((i) => done.has(i.key)).length;

  return (
    <div>
      <TitleBar title="Welcome to the Resource Centre" back="/">
        <form role="search" className="mx-auto flex max-w-[620px]">
          <label className="flex h-[40px] min-w-0 flex-1 items-center gap-2.5 rounded-l-[4px] bg-white pl-3">
            <MagnifyingGlass size={20} aria-hidden="true" className="shrink-0 text-slate-700" />
            <span className="sr-only">Search the Resource Centre</span>
            <input name="q" type="search" defaultValue={sp.q} placeholder="Search guides, videos and templates, for example 'CQC'" className="h-full min-w-0 flex-1 bg-transparent pr-2 text-[15px] text-slate-800 placeholder:text-slate-500 focus:outline-none" />
          </label>
          <button type="submit" className="h-[40px] rounded-r-[4px] bg-teal-500 px-7 text-[15px] font-medium text-navy-950 hover:bg-teal-400">Search</button>
        </form>
      </TitleBar>
      <div className="space-y-4 bg-[#f1f2f5] pb-6 pt-3">
        <Flash searchParams={sp} />
        {q ? (
          <p className="flex items-center gap-2 rounded-[3px] bg-white px-4 py-2.5 text-[14px] text-slate-700">
            <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-[#f06a4d] px-1.5 text-[12px] font-medium text-white">{videos.length + pack.length}</span>
            results for “{sp.q}”
            <Link href="/resource-centre" className="ml-auto text-[13px]">Clear search</Link>
          </p>
        ) : null}

        <section aria-labelledby="videos-heading" className="rounded-[3px] bg-white px-5 pb-5 pt-4">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2.5">
            <h2 id="videos-heading" className="text-[19px] font-normal tracking-normal text-slate-800">CQC Registration Video Library</h2>
            <a href={CQC_REGISTRATION_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px]">CQC registration guidance<ArrowSquareOut size={13} aria-hidden="true" /></a>
          </div>
          {videos.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {videos.map((v, i) => (
                <li key={v.key} className="overflow-hidden rounded-[3px] border border-slate-200" data-testid={`video-${v.key}`}>
                  <div className={`relative h-[150px] overflow-hidden text-white ${TONES[v.tone]}`} aria-hidden="true">
                    <div className="absolute inset-0 bg-[var(--accent)] opacity-90 [clip-path:polygon(62%_0,100%_0,100%_100%,38%_100%)]" />
                    <span className="absolute left-4 top-3 text-[11px] font-bold tracking-wide">CSB · CQC REGISTRATION</span>
                    <span className="absolute left-4 top-9 max-w-[58%] text-[18px] font-bold leading-tight">{v.title}</span>
                    <span className="absolute bottom-3 left-4 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-navy-900">Episode {i + 1}</span>
                    <span className="absolute right-[18%] top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-navy-900 shadow"><Play size={22} weight="fill" /></span>
                  </div>
                  <div className="p-3.5">
                    <p className="text-[15px] font-medium text-[#1d4f91]">{v.title}</p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-600">{v.summary}</p>
                    <p className="mt-2 flex items-center gap-2 text-[12px] text-slate-500"><span>{v.minutes} min</span><span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-inset ring-amber-200">Recording coming soon</span></p>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-[14px] text-slate-500">No videos match your search.</p>}
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-labelledby="pack-heading" className="rounded-[3px] bg-white px-5 pb-5 pt-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2.5">
              <h2 id="pack-heading" className="text-[19px] font-normal tracking-normal text-slate-800">CQC Registration Pack</h2>
              {ctx.organisationId ? <span className="text-[13px] text-slate-600">{complete} of {PACK.length} ready</span> : null}
            </div>
            {ctx.organisationId ? (
              <div className="mb-4 h-[10px] overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={complete} aria-valuemin={0} aria-valuemax={PACK.length} aria-label="Registration pack progress">
                <div className="h-full rounded-full bg-[#3289f8]" style={{ width: `${Math.round((complete / PACK.length) * 100)}%` }} />
              </div>
            ) : null}
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[14px]">
                <thead><tr className="h-[36px] text-left text-[13px] text-slate-700"><th className="w-[46px] font-normal"><span className="sr-only">Ready</span></th><th className="font-normal">What CQC asks for</th><th className="w-[300px] font-normal">CSB documents that help</th></tr></thead>
                <tbody>
                  {pack.map((i) => (
                    <tr key={i.key} className="border-t border-slate-200 odd:bg-[#f5f9fc]" data-testid={`pack-${i.key}`}>
                      <td className="py-2.5 pl-2 align-top">
                        {ctx.organisationId ? (
                          <form action={toggleRegistrationItemAction}>
                            <input type="hidden" name="item" value={i.key} />
                            <input type="hidden" name="back" value={`/resource-centre${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ""}`} />
                            <button type="submit" aria-label={`${done.has(i.key) ? "Untick" : "Tick"} ${i.document}`} className="text-navy-900 hover:text-teal-600">{done.has(i.key) ? <CheckSquare size={24} weight="fill" className="text-emerald-600" /> : <Square size={24} />}</button>
                          </form>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4 align-top"><span className={`font-medium ${done.has(i.key) ? "text-slate-500 line-through decoration-slate-400" : "text-slate-900"}`}>{i.document}</span><span className="block text-[12.5px] leading-5 text-slate-600">{i.why}</span></td>
                      <td className="py-2.5 align-top">
                        <ul className="space-y-0.5">
                          {i.csb?.map((c) => <li key={c.ref}>{docId.get(c.ref) ? <Link href={`/policies/${docId.get(c.ref)}`} className="text-[#1d4f91] no-underline hover:underline">{c.label}</Link> : c.label}</li>)}
                          {i.resource === "business-plan" ? <li><a href="#business-plan" className="text-[#1d4f91] no-underline hover:underline">Business plan template (below)</a></li> : null}
                          {!i.csb && !i.resource ? <li className="text-slate-500">Your own documents</li> : null}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="space-y-4">
            <section id="business-plan" aria-labelledby="plan-heading" className="scroll-mt-24 rounded-[4px] border-[1.5px] border-teal-400 bg-teal-100 px-5 pb-5 pt-4">
              <h2 id="plan-heading" className="text-[19px] font-normal tracking-normal text-navy-900">Business Plan Template</h2>
              <p className="mt-1 text-[13.5px] leading-5 text-slate-700">{plan.description}</p>
              <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px] text-slate-700">
                {plan.sections.slice(1).map((s) => <li key={s.heading} className="flex gap-1.5"><span className="text-teal-600">•</span>{s.heading.replace(/\{\{company_name\}\}/, "your service")}</li>)}
              </ul>
              <p className="mt-3 text-[12.5px] text-slate-600">Your business details from Settings are filled in for you.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="btn-primary" href="/api/resources/business-plan/download?format=docx" download data-testid="business-plan-docx"><FileDoc size={16} aria-hidden="true" />Download Word</a>
                <a className="btn-secondary" href="/api/resources/business-plan/download?format=pdf" download><FilePdf size={16} aria-hidden="true" />PDF</a>
              </div>
            </section>
            <Link href="/interview-prep" className="flex items-center gap-4 rounded-[3px] bg-white px-5 py-4 no-underline shadow-[0_0_0_1px_#eef1f3] hover:shadow-[0_0_0_1px_#c4cfdd]">
              <ChatsCircle size={34} weight="fill" className="shrink-0 text-navy-900" aria-hidden="true" />
              <span><span className="block text-[16px] text-slate-900">Registered manager interview prep</span><span className="block text-[13px] text-slate-600">Likely questions with model answers</span></span>
            </Link>
          </div>
        </div>

        <section aria-labelledby="steps-heading" className="rounded-[3px] bg-white px-5 pb-5 pt-4">
          <h2 id="steps-heading" className="mb-4 border-b border-slate-200 pb-2.5 text-[19px] font-normal tracking-normal text-slate-800">Guide to the CQC application process</h2>
          <ol className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-teal-500 text-[14px] font-medium text-navy-900">{i + 1}</span>
                <div><h3 className="text-[15.5px] font-medium tracking-normal text-navy-900">{s.title}</h3><p className="mt-1 text-[14px] leading-6 text-slate-700">{s.body}</p></div>
              </li>
            ))}
          </ol>
          <p className="mt-5 border-t border-slate-200 pt-3 text-[12.5px] text-slate-500">CSB guidance written from CQC&apos;s public registration guidance. It is not legal advice: check the current guidance on <a href={CQC_REGISTRATION_URL} target="_blank" rel="noreferrer">cqc.org.uk</a> before you apply.</p>
        </section>
      </div>
    </div>
  );
}
