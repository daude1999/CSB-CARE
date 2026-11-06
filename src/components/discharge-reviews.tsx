import Link from "@/components/link";
import { completeDischargeReviewAction, recordDischargeCheckAction } from "@/app/su-record-actions";
import { Badge, Card, fmtDate } from "@/components/ui";
import { CHECK_OUTCOMES, type listDischargeReviews } from "@/server/care/discharge-review";

type Reviews = NonNullable<Awaited<ReturnType<typeof listDischargeReviews>>>;

/** Post-hospital discharge reviews on the person's overview: a checklist per discharge letter, linked to the letter. */
export function DischargeReviews({ reviews, back, serviceUserId }: { reviews: Reviews; back: string; serviceUserId: string }) {
  if (!reviews.length) return null;
  return (
    <section id="discharge" aria-label="Hospital discharge reviews">
      {reviews.map((r) => (
        <Card key={r.id} title={`Hospital discharge review${r.dischargeDate ? `, ${fmtDate(r.dischargeDate)}` : ""}`} actions={<span className="flex gap-2">{r.urgent ? <Badge tone="rose">Urgent</Badge> : null}<Badge tone={r.status === "OPEN" ? "amber" : "teal"}>{r.status === "OPEN" ? "Open" : "Completed"}</Badge></span>}>
          <p className="text-[14px] text-slate-600">
            From {r.documentId ? <Link href={`/rota/service-users/${serviceUserId}?tab=documents&section=${r.documentSection}&doc=${r.documentId}`}>{r.documentName}</Link> : r.documentName}
            {r.intakeId ? <> (<Link href={`/rota/coordinator/${r.intakeId}`}>Care Coordinator intake</Link>)</> : null}. The council support plan is not replaced by this letter, and no medicine is authorised from it.
          </p>
          {r.urgent ? <p role="alert" className="mt-2 rounded-[3px] border border-[#f3c6c6] bg-[#fdf1f1] px-3 py-2 text-[14px] text-[#8c1d1d]">{r.urgentReasons.join(". ")}. Managers were alerted in the CRM. Check before the next visit.</p> : null}
          <ul className="rows mt-2">
            {r.checks.map((c) => (
              <li key={c.key} className="py-2 text-[14px]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span><span className="font-medium">{c.label}</span><span className="block text-[13px] text-slate-600">{c.finding ?? "Nothing found in the letter. Check the original."}</span></span>
                  {c.outcome ? <span className="text-[13px]"><Badge tone={c.outcome === "ACTION" ? "amber" : "teal"}>{CHECK_OUTCOMES[c.outcome]}</Badge>{c.note ? <span className="block text-slate-600">{c.note}</span> : null}</span> : null}
                </div>
                {r.status === "OPEN" ? (
                  <form action={recordDischargeCheckAction} className="mt-1 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="reviewId" value={r.id} />
                    <input type="hidden" name="lockVersion" value={r.lockVersion} />
                    <input type="hidden" name="key" value={c.key} />
                    <select name="outcome" className="input w-auto py-1 text-[13px]" aria-label={`Outcome for ${c.label}`} defaultValue={c.outcome ?? ""}><option value="" disabled>Choose</option>{Object.entries(CHECK_OUTCOMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    <input name="note" className="input w-auto min-w-[200px] flex-1 py-1 text-[13px]" placeholder={c.key === "medication" ? "How the medicines were reconciled (required)" : "Note (required for action needed)"} aria-label={`Note for ${c.label}`} defaultValue={c.note ?? ""} />
                    <button className="btn-secondary py-1">Save</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          {r.status === "OPEN" ? (
            <form action={completeDischargeReviewAction} className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="reviewId" value={r.id} />
              <input type="hidden" name="lockVersion" value={r.lockVersion} />
              <input name="outcome" required minLength={3} className="input min-w-[240px] flex-1 py-1" placeholder="Summary of the review" aria-label="Summary of the review" />
              <button className="btn-primary py-1">Complete review</button>
            </form>
          ) : <p className="mt-2 text-[13.5px] text-slate-600">Completed {r.completedAt ? fmtDate(r.completedAt, true) : ""}: {r.outcome}</p>}
        </Card>
      ))}
    </section>
  );
}
