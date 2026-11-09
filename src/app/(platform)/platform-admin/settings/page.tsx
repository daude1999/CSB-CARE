import { requireCtx } from "@/server/auth/current";
import { allSettings, SETTING_GROUPS } from "@/server/platform/settings";
import { MODULES } from "@/lib/platform-modules";
import { aiProviderProblem, aiProviderSetting } from "@/server/ai";
import { emailProvider } from "@/server/notifications/email";
import { deploymentInfo } from "@/server/platform/health";
import { Flash, fmtDate } from "@/components/ui";
import { Back, KeyValues, PasswordField, PxHeader, PxPanel, pxPrimary } from "@/components/platform/ui";
import { updateSettingsAction } from "@/app/platform-actions";
import Link from "@/components/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform Settings" };

/** Platform-wide settings. Each one states its effect. Secrets stay in the hosting environment and are never shown. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const settings = await allSettings(ctx);
  const dep = deploymentInfo();
  const readOnly: Record<string, [string, string][]> = {
    authentication: [["Session length", "12 hours without activity, 7 days at most (fixed in code)"], ["Failed sign-in protection", "5 wrong passwords per email or 30 per network address in 15 minutes"], ["Multi-factor sign-in", "Not available yet"], ["Password storage", "bcrypt hashes; never visible"]],
    notifications: [["System email", emailProvider().name === "smtp" ? "SMTP configured in the hosting environment" : "Not configured: nothing is emailed"], ["Sender address", process.env.EMAIL_FROM ? "Set in the hosting environment" : "Not set"]],
    ai: [["Provider", aiProviderSetting()], ["Status", aiProviderProblem() ?? "Ready"], ["Model", process.env.ANTHROPIC_MODEL?.trim() || "Platform default"], ["API key", process.env.ANTHROPIC_API_KEY?.trim() ? "Configured (never shown)" : "Not configured"]],
    maintenance: [["Deployed version", dep.commit ?? "Not reported by the host"], ["Environment", dep.environment]],
  };
  return (
    <>
      <PxHeader title="Platform Settings" description="Settings that apply across every client. Each says exactly what it changes. API keys and passwords are kept in the hosting environment and are never stored or shown here." />
      <Flash searchParams={sp} />
      <div className="space-y-4">
        {SETTING_GROUPS.map((g) => {
          const items = settings.filter((s) => s.group === g.id);
          const sensitive = items.some((s) => s.sensitive);
          return (
            <PxPanel key={g.id} id={g.id} title={g.name} description={sensitive ? "Changing these needs your password." : undefined}>
              {readOnly[g.id] ? <div className="mb-4 rounded-[6px] bg-[#f7f8fb] p-3"><KeyValues items={readOnly[g.id]!} /></div> : null}
              <form action={updateSettingsAction} className="space-y-4">
                <Back value={`/platform-admin/settings#${g.id}`} />
                <input type="hidden" name="group" value={g.id} />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {items.map((s) => (
                    <div key={s.key} className={s.kind === "modules" || s.kind === "longtext" ? "md:col-span-2" : ""}>
                      {s.kind === "bool" ? (
                        <label className="flex items-center gap-2 text-[14px] font-medium"><input type="checkbox" name={s.key} defaultChecked={Boolean(s.value)} />{s.label}</label>
                      ) : s.kind === "modules" ? (
                        <fieldset><legend className="label">{s.label}</legend><div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">{MODULES.map((m) => <label key={m.key} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name={s.key} value={m.key} defaultChecked={(s.value as string[]).includes(m.key)} />{m.name}</label>)}</div></fieldset>
                      ) : s.kind === "longtext" ? (
                        <label className="block"><span className="label">{s.label}</span><textarea name={s.key} rows={2} defaultValue={String(s.value ?? "")} maxLength={300} className="input" /></label>
                      ) : (
                        <label className="block"><span className="label">{s.label}</span><input name={s.key} type={s.kind === "int" ? "number" : s.kind === "email" ? "email" : "text"} defaultValue={s.value === null ? "" : String(s.value)} className="input" /></label>
                      )}
                      <p className="mt-1 text-[12px] leading-4 text-[#5b6478]">{s.effect}{s.updatedAt ? ` Last changed ${fmtDate(s.updatedAt, true)}.` : " Using the default."}</p>
                    </div>
                  ))}
                </div>
                {sensitive ? <div className="max-w-sm"><PasswordField /></div> : null}
                <button className={pxPrimary}>Save {g.name.toLowerCase()}</button>
              </form>
              {g.id === "maintenance" ? <p className="mt-3 text-[12.5px] text-[#5b6478]">System health, background jobs and restore tests: see <Link href="/platform-admin/health">Platform Health</Link>, <Link href="/platform-admin/jobs">Background Jobs</Link> and <Link href="/platform-admin/storage">Storage &amp; Infrastructure</Link>.</p> : null}
            </PxPanel>
          );
        })}
      </div>
    </>
  );
}
