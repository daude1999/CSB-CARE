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
      <PageHeader eyebrow="Inbox" title="Notifications" actions={items.some((n) => !n.readAt) ? (
        <form action={markNotificationsReadAction}><input type="hidden" name="back" value="/notifications" /><button className="btn-secondary" type="submit">Mark all read</button></form>
      ) : null} />
      <Flash searchParams={sp} />
      <Card>
        {items.length ? (
          <ul className="divide-y divide-slate-100" data-testid="notification-list">
            {items.map((n) => {
              const links = (n.links as { label: string; url: string }[]) ?? [];
              return (
                <li key={n.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.readAt ? <Badge tone="teal">new</Badge> : null}
                    <span className="font-medium">{n.title}</span>
                    <span className="text-xs text-slate-400">{fmtDate(n.createdAt, true)}</span>
                  </div>
                  <p className="text-sm">{n.body}</p>
                  <p className="text-xs text-slate-500">Why you received this: {n.reason}{n.dueAt ? ` · due ${fmtDate(n.dueAt)}` : ""}</p>
                  <div className="mt-1 flex gap-3 text-sm">{links.filter((l) => l.url.startsWith("/")).map((l, i) => <Link key={i} href={l.url}>{l.label}</Link>)}</div>
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
