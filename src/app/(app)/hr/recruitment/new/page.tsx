import { notFound } from "next/navigation";
import { HrPageHeader } from "@/components/module-header";
import Link from "@/components/link";
import { AppError } from "@/lib/errors";
import { requirePortal } from "@/server/auth/portals";
import { recruitmentAccess, staffChoices } from "@/server/recruitment/access";
import { COMMON_DOCUMENTS } from "@/server/recruitment/model";
import { createCandidateAction } from "@/app/recruitment-actions";
import { Flash } from "@/components/ui";
import { CandidateFields, R_PANEL, R_PRIMARY, R_SECONDARY } from "@/components/recruitment-ui";

export const dynamic = "force-dynamic";

export default async function NewCandidatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("hr");
  const a = await recruitmentAccess(ctx).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  if (!a.canEdit) notFound();
  const people = await staffChoices(a.organisationId);
  return (
    <div className="-mt-1">
      <HrPageHeader title="Add Candidate" back="/hr/recruitment" subtitle="Record a new application. The candidate starts at Applied; nothing is sent to them." />
      <Flash searchParams={sp} />
      <form action={createCandidateAction} className={`${R_PANEL} p-4`} aria-label="New candidate">
        <input type="hidden" name="back" value="/hr/recruitment/new" />
        <CandidateFields branches={a.branches} recruiters={people.filter((p) => p.hr)} documents={COMMON_DOCUMENTS} v={{ recruiterId: ctx.userId, outstandingDocuments: ["Proof of identity", "Right to work document", "Two references", "DBS application"] }} />
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[#eaecf0] pt-4">
          <button className={R_PRIMARY}>Add Candidate</button>
          <Link href="/hr/recruitment" className={R_SECONDARY}>Cancel</Link>
        </div>
      </form>
    </div>
  );
}
