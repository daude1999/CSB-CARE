import Link from "@/components/link";
import { splitTags, tagLabel, type BusinessDetails } from "@/lib/business";

/** Text with its {{tags}} shown as soft pills holding the organisation's details from Settings. */
export function TagText({ text, details }: { text: string; details: Partial<BusinessDetails> | null }) {
  return (
    <>
      {splitTags(text, details).map((p, i) =>
        "text" in p ? (
          <span key={i}>{p.text}</span>
        ) : p.value ? (
          <span key={i} data-tag={p.tag} title={`${tagLabel(p.tag)}, from Settings`} className="mx-px whitespace-nowrap rounded-full border border-teal-200 bg-teal-50 px-2 py-px text-[0.92em] font-medium text-navy-900 [box-decoration-break:clone]">
            {p.value}
          </span>
        ) : (
          <Link key={i} href="/settings#business" data-tag={p.tag} title="Not set yet. Add it in Settings" className="mx-px whitespace-nowrap rounded-full border border-dashed border-amber-400 bg-amber-50 px-2 py-px text-[0.92em] font-medium text-amber-900 no-underline hover:bg-amber-100">
            {tagLabel(p.tag)}
          </Link>
        ),
      )}
    </>
  );
}

/** A section body: paragraphs, bullets and numbered steps, each with tags filled in. */
export function TagBody({ body, details, className = "" }: { body: string; details: Partial<BusinessDetails> | null; className?: string }) {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i} className="pl-1"><TagText text={t} details={details} /></li>);
    out.push(list.ordered ? <ol key={out.length} className="ml-5 list-decimal space-y-1.5 marker:text-slate-500">{items}</ol> : <ul key={out.length} className="ml-5 list-disc space-y-1.5 marker:text-teal-500">{items}</ul>);
    list = null;
  };
  for (const line of lines) {
    const bullet = line.match(/^[•\-*]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    flush();
    out.push(<p key={out.length}><TagText text={line.replace(/^\[Complete locally\]\s*/, "")} details={details} /></p>);
  }
  flush();
  return <div className={`space-y-3 ${className}`}>{out}</div>;
}
