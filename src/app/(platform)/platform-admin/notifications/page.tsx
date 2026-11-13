import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { requirePlatform } from "@/server/platform/access";
import { getSetting } from "@/server/platform/settings";
import { emailProvider } from "@/server/notifications/email";
import { fmtDate } from "@/components/ui";
import { EmptyRow, PxHeader, PxPanel, pxSecondary, SettingsRow, Table } from "@/components/platform/ui";

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
  const sent: [string, string, string][] = [
    ["Security alerts to platform administrators", alertsOn ? "On, in-app" : "Off", "Role changes, deactivations, suspensions and emergency support access."],
    ["Support access requests", "Always, in-app", "Sent to the client's administrators."],
    ["Emergency support access", "Always, in-app", "Sent to the client's administrators at once."],
    ["Client onboarding invitation", "Shown once to Evantix", "Not emailed. Hand the single-use link over yourself."],
    ["Password reset links", email ? "Shown once, or emailed" : "Shown once", email ? "You choose when you create the link." : "Email is not configured."],
    ["Subscription messages to clients", "Not built yet", "No billing provider is connected."],
    ["System incident notices", "Maintenance banner", "Set in Platform Settings, Maintenance."],
  ];
  return (
    <>
      <PxHeader title="Notifications" description="Who the platform tells about administration events. Notices go to the in-app bell. Email is used only where it says so, and only when email is configured." actions={<Link href="/platform-admin/settings?section=notifications" className={pxSecondary}>Notification settings</Link>} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <PxPanel title="Your security alerts" flush>
          <div className="px-4">
            <Table label="Your security alerts" minWidth={520} head={["When", "Alert", ""]} empty={mine.length ? null : <EmptyRow>{alertsOn ? "No alerts yet." : "Security alerts are switched off."}</EmptyRow>}>
              {mine.map((n) => <tr key={n.id}><td className="whitespace-nowrap tabular-nums">{fmtDate(n.createdAt, true)}</td><td><span className="font-medium text-px-ink">{n.title}</span><span className="block text-[12.5px] text-px-muted">{n.body}</span></td><td className="text-right">{n.actionUrl ? <Link href={n.actionUrl} className="text-[13px]">Open</Link> : null}</td></tr>)}
            </Table>
          </div>
        </PxPanel>
        <PxPanel title="What is sent">
          {sent.map(([label, value, help]) => <SettingsRow key={label} label={label} help={help}><p className="text-[13.5px] text-px-body md:text-right">{value}</p></SettingsRow>)}
        </PxPanel>
      </div>
    </>
  );
}
