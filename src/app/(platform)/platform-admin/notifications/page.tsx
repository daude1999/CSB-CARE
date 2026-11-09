import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { requirePlatform } from "@/server/platform/access";
import { getSetting } from "@/server/platform/settings";
import { emailProvider } from "@/server/notifications/email";
import { fmtDate } from "@/components/ui";
import { EmptyRow, KeyValues, PxHeader, PxPanel, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

/** What the Admin Centre tells people, and how. Everything is in-app unless email is configured. */
export default async function NotificationsPage() {
  const ctx = await requireCtx();
  requirePlatform(ctx, "platform.view");
  const [alertsOn, mine] = await Promise.all([
    getSetting("notifications.securityAlerts"),
    db.notification.findMany({ where: { userId: ctx.userId, type: { in: ["PLATFORM_SECURITY"] } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const email = emailProvider().name === "smtp";
  return (
    <>
      <PxHeader title="Notifications" description="Who the platform tells about administration events. All notices go to the in-app bell; email is used only where it says so and only when email is configured." actions={<Link href="/platform-admin/settings#notifications" className="text-[13px]">Notification settings</Link>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <PxPanel title="Your security alerts">
          <Table head={["When", "Alert", ""]} empty={mine.length ? null : <EmptyRow>{alertsOn ? "No alerts yet." : "Security alerts are switched off."}</EmptyRow>}>
            {mine.map((n) => <tr key={n.id}><td className="whitespace-nowrap">{fmtDate(n.createdAt, true)}</td><td><span className="font-medium">{n.title}</span><span className="block text-[12.5px] text-[#46505f]">{n.body}</span></td><td>{n.actionUrl ? <Link href={n.actionUrl} className="text-[13px]">Open</Link> : null}</td></tr>)}
          </Table>
        </PxPanel>
        <PxPanel title="What is sent">
          <KeyValues items={[
            ["Security alerts to platform administrators", alertsOn ? "On (in-app)" : "Off"],
            ["Support access requests to the client's administrators", "Always (in-app)"],
            ["Emergency support access to the client's administrators", "Always (in-app)"],
            ["Customer onboarding invitation", "Single-use link shown once to Evantix; not emailed"],
            ["Password reset links", email ? "Shown once, or emailed when you choose" : "Shown once; email not configured"],
            ["Subscription messages to clients", "Not built yet: no billing provider is connected"],
            ["System incident notices", "Use the maintenance notice in Platform Settings"],
          ]} />
        </PxPanel>
      </div>
    </>
  );
}
