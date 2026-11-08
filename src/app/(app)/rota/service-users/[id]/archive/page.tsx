import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { orNotFound } from "@/server/auth/page-guard";
import { getServiceUser } from "@/server/care/service-users";
import { serviceUserArchiveStatus } from "@/server/care/service-user-archive";
import { suName } from "@/server/rota/queries";
import { archiveServiceUserAction, deleteServiceUserAction, restoreServiceUserAction } from "@/app/rota-actions";
import { Badge, Card, Flash, fmtDate, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Archive or Delete one service user. Archive (managers and admins) hides the person from the active lists, keeps every
 * record and can be undone with Restore. Delete (admins only) is for records added by mistake: the person must be
 * archived first, must have no care records, and the admin types the CSB reference to confirm. Every rule here is
 * checked again on the server (service-user-archive.ts); the page only explains it.
 */
export default async function ArchiveServiceUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("serviceUser.view");
  const su = await orNotFound(getServiceUser(ctx, id));
  const st = await serviceUserArchiveStatus(ctx, su.id);
  const name = suName(su);
  const self = `/rota/service-users/${su.id}/archive`;
  return (
    <>
      <PageHeader
        title={`Archive or delete: ${name}`}
        back={`/rota/service-users/${su.id}`}
        subtitle={`${st.reference} · ${su.area?.name ?? "no area"} · ${su.postcode ?? "no postcode"}`}
        actions={<div className="flex items-center gap-2">{st.archived ? <Badge tone="slate">Archived</Badge> : null}<StatusBadge status={su.status} /></div>}
      />
      <Flash searchParams={sp} />
      <div className="grid max-w-[880px] grid-cols-1 gap-3">
        {st.archived ? (
          <Card title="Archived" className="border-l-4 border-l-slate-400">
            <p className="text-[14.5px] text-slate-700" data-testid="archived-summary">
              Archived on {fmtDate(st.archived.at, true)} by {st.archived.by}. {st.archived.reason ? <>Reason: {st.archived.reason}</> : null}
            </p>
            <p className="mt-2 text-[14.5px] text-slate-700">The record is hidden from the active lists and is read-only. Every care record is kept.</p>
            {st.mayArchive ? (
              <form action={restoreServiceUserAction} className="mt-4 grid gap-3" data-testid="restore-form">
                <input type="hidden" name="serviceUserId" value={su.id} />
                <input type="hidden" name="back" value={self} />
                <label className="block">
                  <span className="label">Why are you restoring {name}?</span>
                  <input name="reason" required minLength={3} maxLength={500} className="input max-w-[560px]" placeholder="For example: care is starting again" />
                </label>
                <div><button type="submit" className="btn-primary" data-testid="restore-submit">Restore to active lists</button></div>
              </form>
            ) : <p className="mt-3 text-[14px] text-slate-600">Only a care manager or an organisation admin can restore an archived person.</p>}
          </Card>
        ) : (
          <Card title="Archive">
            <p className="text-[14.5px] text-slate-700">Archive hides {name} from All Service Users, the rota and the pickers, and makes the record read-only. <strong className="font-semibold">Nothing is deleted</strong>: visits, notes, medicines, documents and history are all kept, and you can restore the person at any time.</p>
            {st.archiveBlockers.length ? (
              <div role="status" className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-900" data-testid="archive-blockers">
                <p className="font-semibold">{name} can&apos;t be archived yet</p>
                <ul className="mt-1 list-disc pl-5">{st.archiveBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
                <p className="mt-2"><Link href={`/rota/service-users/${su.id}?tab=details`}>Open personal details to change the status</Link></p>
              </div>
            ) : null}
            {st.mayArchive ? (
              st.archiveBlockers.length ? null : (
                <form action={archiveServiceUserAction} className="mt-4 grid gap-3" data-testid="archive-form">
                  <input type="hidden" name="serviceUserId" value={su.id} />
                  <input type="hidden" name="back" value={self} />
                  <label className="block">
                    <span className="label">Why are you archiving {name}?</span>
                    <input name="reason" required minLength={3} maxLength={500} className="input max-w-[560px]" placeholder="For example: care ended, moved to a care home" />
                  </label>
                  <div><button type="submit" className="btn-primary" data-testid="archive-submit">Archive {name}</button></div>
                </form>
              )
            ) : <p className="mt-3 text-[14px] text-slate-600">Only a care manager or an organisation admin can archive a person.</p>}
          </Card>
        )}

        <Card title="Delete permanently">
          <p className="text-[14.5px] text-slate-700">Delete is only for a record added by mistake, such as a duplicate or a test. It can&apos;t be undone. Care records must be kept after care ends, so a person with any care record can only be archived.</p>
          {!st.mayDelete ? (
            <p className="mt-3 text-[14px] text-slate-600" data-testid="delete-admin-only">Only an organisation admin can delete a service user.</p>
          ) : !st.archived ? (
            <p className="mt-3 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-[14px] text-slate-700" data-testid="delete-archive-first">Archive {name} first. Only an archived record can be deleted.</p>
          ) : st.deleteBlockers.length ? (
            <div role="status" className="mt-3 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-[14px] text-slate-800" data-testid="delete-blockers">
              <p className="font-semibold">{name} has care records that must be kept, so they can&apos;t be deleted:</p>
              <ul className="mt-1 list-disc pl-5">{st.deleteBlockers.map((b) => <li key={b.label}>{b.text}</li>)}</ul>
              <p className="mt-2">Keep them archived. The record stays hidden from the active lists.</p>
            </div>
          ) : (
            <form action={deleteServiceUserAction} className="mt-4 grid gap-3 rounded-[8px] border border-rose-200 bg-rose-50/60 p-4" data-testid="delete-form">
              <input type="hidden" name="serviceUserId" value={su.id} />
              <input type="hidden" name="back" value={self} />
              <p className="text-[14px] font-semibold text-rose-900">This permanently removes {name}, their contacts, care package, draft plans and reference numbers. It can&apos;t be undone.</p>
              <label className="block">
                <span className="label">Why are you deleting this record?</span>
                <input name="reason" required minLength={3} maxLength={500} className="input max-w-[560px]" placeholder="For example: duplicate of another record" />
              </label>
              <label className="block">
                <span className="label">To confirm, type the CSB reference <span className="font-semibold tabular-nums">{st.reference}</span></span>
                <input name="confirm" required autoComplete="off" spellCheck={false} className="input max-w-[260px] tabular-nums" />
              </label>
              <div><button type="submit" className="btn-danger" data-testid="delete-submit">Delete permanently</button></div>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
