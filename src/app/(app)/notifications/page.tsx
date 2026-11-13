import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { markNotificationsReadAction } from "../../actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const items = await db.notification.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <PageHeader eyebrow="Inbox" title="Notifications" subtitle="Everything CSB has asked you to look at, newest first, with the reason you received it." actions={items.some((n) => !n.readAt) ? (
        <form action={markNotificationsReadAction}><input type="hidden" name="back" value="/notifications" /><button className="btn-secondary" type="submit">Mark all read</button></form>
      ) : null} />
      <Flash searchParams={sp} />
      <Card>
        {items.length ? (
          <ul className="rows" data-testid="notification-list">
            {items.map((n) => {
              const links = (n.links as { label: string; url: string }[]) ?? [];
              return (
                <li key={n.id} className={`border-l-4 py-3 ${n.readAt ? "border-transparent" : "border-[#f06a4d]"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.readAt ? <Badge tone="rose">new</Badge> : null}
                    <span className="text-[15.5px] font-medium text-[#1d4f91]">{n.title}</span>
                    <span className="text-[12.5px] text-slate-500">{fmtDate(n.createdAt, true)}</span>
                  </div>
                  <p className="mt-1 text-[14px] text-slate-800">{n.body}</p>
                  <p className="mt-0.5 text-[13px] text-slate-600">Why you received this: {n.reason}{n.dueAt ? ` · due ${fmtDate(n.dueAt)}` : ""}</p>
                  <div className="mt-2 flex flex-wrap gap-2">{links.filter((l) => l.url.startsWith("/")).map((l, i) => <Link key={i} href={l.url} className="btn-secondary py-1 text-[13px]">{l.label}</Link>)}</div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No notifications.</Empty>
        )}
      </Card>
    </>
  );
}
