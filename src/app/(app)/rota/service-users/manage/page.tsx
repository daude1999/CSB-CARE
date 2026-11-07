import type { ReactNode } from "react";
import { ArrowsClockwise, FileArrowUp, FirstAidKit, NotePencil, ListBullets, PencilSimple, UserPlus, UsersThree } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { serviceUserActionPerms, serviceUserDirectory } from "@/server/care/service-users";
import { rotaLookups } from "@/server/rota/queries";
import { Flash, PageHeader } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";
import { DIRECTORY_STATUSES, ServiceUserDirectory } from "@/components/service-user-directory";
import { ADD_MANUAL_HREF, ADD_UPLOAD_HREF, UpdateServiceUserButton } from "@/components/service-user-actions";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b2bb5] focus-visible:ring-offset-2";
const CARD_BTN = `inline-flex min-h-10 flex-auto items-center whitespace-nowrap justify-center gap-2 rounded-[9px] border border-[#cfc3ef] bg-white px-3 py-2 text-center text-[14px] font-semibold text-[#4a2196] no-underline hover:border-[#5b2bb5] hover:bg-[#f8f5fe] hover:text-[#4a2196] ${FOCUS}`;

const VIEW_BTN = `inline-flex min-h-10 flex-auto items-center whitespace-nowrap justify-center gap-2 rounded-[9px] border border-[#b9dcc6] bg-white px-3 py-2 text-center text-[14px] font-semibold text-[#1f5f3a] no-underline hover:border-[#1f7a46] hover:bg-[#f3faf6] hover:text-[#1f5f3a] ${FOCUS}`;

function ActionCard({ icon, title, text, tone, children, testId }: { icon: ReactNode; title: string; text: string; tone: "purple" | "blue" | "green"; children: ReactNode; testId: string }) {
  const bg = { purple: "bg-[#faf8ff] border-[#ebe4fb]", blue: "bg-[#f7f9ff] border-[#e1e8fb]", green: "bg-[#f6fbf8] border-[#dcefe3]" }[tone];
  const dot = { purple: "bg-[#efe9fc] text-[#5b2bb5]", blue: "bg-[#e8eefc] text-[#3559c7]", green: "bg-[#e3f3e9] text-[#1f7a46]" }[tone];
  return (
    <section aria-labelledby={`${testId}-h`} className={`flex flex-col rounded-[12px] border p-4 ${bg}`} data-testid={testId}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${dot}`}>{icon}</span>
        <div className="min-w-0">
          <h2 id={`${testId}-h`} className="text-[17px] font-bold text-[#101828]">{title}</h2>
          <p className="mt-0.5 text-[13.5px] leading-5 text-[#475467]">{text}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

/**
 * Service User Management: the main workspace. Add a person (support plan or by hand), update someone already on the
 * system (revised plan, hospital discharge or by hand) and the full All Service Users directory below. Every action is
 * the same component and destination as on the directory page; nothing here is a second form or a second intake.
 */
export default async function ServiceUserManagementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("serviceUser.view");
  const perms = serviceUserActionPerms(ctx);
  const org = ctx.organisationId ? await db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { isDemo: true } }) : null;
  const status = sp.status === "ALL" ? "ALL" : DIRECTORY_STATUSES.find((s) => s === sp.status) ?? "CURRENT";
  const [dir, lk] = await Promise.all([serviceUserDirectory(ctx, { q: sp.q, status, areaId: sp.area || undefined, page: Number(sp.page) || 1 }), rotaLookups(ctx)]);
  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="people" active="manage" />} title="Service User Management" back="/rota" subtitle="Add new service users, update existing records and manage every service-user profile in one place." />
      <Flash searchParams={sp} />
      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.45fr_0.9fr]">
        {perms.create || perms.upload ? (
          <ActionCard icon={<UserPlus size={20} />} title="Add New Service User" text="Create a new profile from a council support plan read by CSB AI, or by entering the details by hand." tone="purple" testId="card-add">
            {perms.upload ? <Link href={ADD_UPLOAD_HREF} className={CARD_BTN} data-testid="card-add-upload"><FileArrowUp size={16} aria-hidden />Upload Support Plan</Link> : null}
            {perms.create ? <Link href={ADD_MANUAL_HREF} className={CARD_BTN} data-testid="card-add-manual"><PencilSimple size={16} aria-hidden />Add Manually</Link> : null}
          </ActionCard>
        ) : null}
        {perms.edit || perms.upload ? (
          <ActionCard icon={<ArrowsClockwise size={20} />} title="Update Existing Service User" text="Choose the person, then update their existing profile from new documents or by hand. Their history is kept." tone="blue" testId="card-update">
            <UpdateServiceUserButton perms={perms} method="revised" label="Upload Revised Support Plan" className={CARD_BTN} icon={<FileArrowUp size={16} aria-hidden />} testId="card-update-revised" />
            <UpdateServiceUserButton perms={perms} method="discharge" label="Hospital Discharge" className={CARD_BTN} icon={<FirstAidKit size={16} aria-hidden />} testId="card-update-discharge" />
            <UpdateServiceUserButton perms={perms} method="manual" label="Update Manually" className={CARD_BTN} icon={<NotePencil size={16} aria-hidden />} testId="card-update-manual" />
          </ActionCard>
        ) : null}
        <ActionCard icon={<UsersThree size={20} />} title="View All Service Users" text="Search, open and manage existing service-user profiles." tone="green" testId="card-view">
          <Link href="/rota/service-users" className={VIEW_BTN} data-testid="card-view-all"><ListBullets size={16} aria-hidden />Go to All Service Users</Link>
        </ActionCard>
      </div>
      <ServiceUserDirectory dir={dir} sp={sp} areas={lk.areas} basePath="/rota/service-users/manage" perms={perms} showButtons={false} demo={!!org?.isDemo} />
    </>
  );
}
