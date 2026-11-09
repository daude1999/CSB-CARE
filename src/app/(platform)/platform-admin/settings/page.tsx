import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { allSettings, SETTING_GROUPS, type SettingGroup } from "@/server/platform/settings";
import { MODULES } from "@/lib/platform-modules";
import { aiProviderProblem, aiProviderSetting } from "@/server/ai";
import { emailProvider } from "@/server/notifications/email";
import { deploymentInfo } from "@/server/platform/health";
import { fmtDate } from "@/components/ui";
import { Back, NotConfigured, PasswordField, PxFlash, PxHeader, PxPanel, pxPrimary, SettingsRow } from "@/components/platform/ui";
import { updateSettingsAction } from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform Settings" };

const SECTIONS: Record<SettingGroup, { name: string; summary: string }> = {
  general: { name: "General", summary: "Platform name and the support contact customers see." },
  authentication: { name: "Authentication & Security", summary: "Invitation and reset links, password rules and sign-in protection." },
  notifications: { name: "Notifications", summary: "Who is told about security and administration events." },
  ai: { name: "AI Configuration", summary: "Token prices for cost estimates and a platform-wide request ceiling." },
  customers: { name: "Client Defaults", summary: "What a new client starts with." },
  maintenance: { name: "Maintenance", summary: "The banner shown to everyone during planned work." },
};

/** Related pages that hold the rest of each category, so nothing is duplicated here. */
const RELATED: Partial<Record<SettingGroup, [string, string][]>> = {
  authentication: [["/platform-admin/security", "Security audit"], ["/platform-admin/support", "Support access"], ["/platform-admin/passwords", "Passwords"], ["/platform-admin/sessions", "Sessions"]],
  notifications: [["/platform-admin/notifications", "Notification recipients"]],
  ai: [["/platform-admin/ai", "AI usage"]],
  customers: [["/platform-admin/plans", "Plans"], ["/platform-admin/modules", "Modules"]],
  maintenance: [["/platform-admin/health", "System health"], ["/platform-admin/jobs", "Background jobs"], ["/platform-admin/storage", "Storage and restore tests"]],
};

function Fixed({ children }: { children: React.ReactNode }) {
  return <p className="text-[13.5px] text-px-body md:pt-0.5">{children}</p>;
}

/** Platform-wide settings, one category at a time. Secrets stay in the hosting environment and are never shown. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const settings = await allSettings(ctx);
  const section: SettingGroup = SETTING_GROUPS.some((g) => g.id === sp.section) ? (sp.section as SettingGroup) : "general";
  const here = `/platform-admin/settings?section=${section}`;
  const items = settings.filter((s) => s.group === section);
  const sensitive = items.some((s) => s.sensitive);
  const dep = deploymentInfo();
  const smtp = emailProvider().name === "smtp";
  const fixed: Partial<Record<SettingGroup, [string, React.ReactNode, string][]>> = {
    authentication: [
      ["Session length", "12 hours without activity, 7 days at most", "Fixed in code."],
      ["Failed sign-in protection", "5 wrong passwords per email, or 30 per network address, in 15 minutes", "Fixed in code."],
      ["Multi-factor sign-in", <NotConfigured key="mfa">Not available yet</NotConfigured>, "Planned. Not built."],
      ["Password storage", "bcrypt hashes, never visible", "Fixed in code."],
    ],
    notifications: [
      ["System email", smtp ? "SMTP configured" : <NotConfigured key="e">Not configured: nothing is emailed</NotConfigured>, "Set in the hosting environment."],
      ["Sender address", process.env.EMAIL_FROM ? "Set" : <NotConfigured key="f">Not set</NotConfigured>, "Set in the hosting environment."],
    ],
    ai: [
      ["Provider", aiProviderSetting(), "Set in the hosting environment."],
      ["Status", aiProviderProblem() ?? "Ready", "Checked when this page opened."],
      ["Model", process.env.ANTHROPIC_MODEL?.trim() || "Platform default", "Set in the hosting environment."],
      ["API key", process.env.ANTHROPIC_API_KEY?.trim() ? "Configured (never shown)" : <NotConfigured key="k">Not configured</NotConfigured>, "Kept in the hosting environment only."],
    ],
    maintenance: [
      ["Deployed version", dep.commit ?? "Not reported by the host", "Reported by the host."],
      ["Environment", dep.environment, "Reported by the host."],
    ],
  };
  return (
    <>
      <PxHeader title="Platform Settings" description="Settings that apply across every client. API keys and passwords stay in the hosting environment and are never stored or shown here." />
      <PxFlash searchParams={sp} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings categories" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {SETTING_GROUPS.map((g) => (
              <li key={g.id} className="shrink-0">
                <Link href={`/platform-admin/settings?section=${g.id}`} aria-current={g.id === section ? "page" : undefined} className={`block rounded-[6px] px-3 py-2 text-[13.5px] no-underline ${g.id === section ? "bg-px-accent-soft font-medium text-px-accent-strong" : "text-px-body hover:bg-px-hover hover:text-px-ink"}`}>{SECTIONS[g.id].name}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-5">
          <PxPanel title={SECTIONS[section].name} description={SECTIONS[section].summary}>
            <form action={updateSettingsAction}>
              <Back value={here} />
              <input type="hidden" name="group" value={section} />
              {items.map((s) => {
                const help = <>{s.effect} <span className="text-px-subtle">{s.updatedAt ? `Last changed ${fmtDate(s.updatedAt, true)}.` : "Using the default."}</span></>;
                const id = `set-${s.key.replace(/\./g, "-")}`;
                if (s.kind === "modules") {
                  return (
                    <fieldset key={s.key} className="border-b border-px-row py-4 last:border-0">
                      <legend className="float-left w-full text-[13.5px] font-medium text-px-ink">{s.label}</legend>
                      <p className="clear-both pt-0.5 text-[12.5px] leading-[18px] text-px-muted">{help}</p>
                      <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">{MODULES.map((m) => <label key={m.key} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name={s.key} value={m.key} defaultChecked={(s.value as string[]).includes(m.key)} />{m.name}</label>)}</div>
                    </fieldset>
                  );
                }
                return (
                  <SettingsRow key={s.key} label={s.label} help={help} htmlFor={id}>
                    {s.kind === "bool" ? (
                      <label className="flex items-center gap-2 text-[13.5px] md:pt-0.5"><input id={id} type="checkbox" name={s.key} defaultChecked={Boolean(s.value)} />On</label>
                    ) : s.kind === "longtext" ? (
                      <textarea id={id} name={s.key} rows={3} defaultValue={String(s.value ?? "")} maxLength={300} className="input" />
                    ) : (
                      <input id={id} name={s.key} type={s.kind === "int" ? "number" : s.kind === "email" ? "email" : "text"} defaultValue={s.value === null ? "" : String(s.value)} placeholder={s.value === null ? "Not set" : undefined} className="input" />
                    )}
                  </SettingsRow>
                );
              })}
              <div className="mt-2 flex flex-col gap-3 border-t border-px-divider pt-4 sm:flex-row sm:items-end sm:justify-between">
                {sensitive ? <div className="w-full max-w-sm"><PasswordField label="Your password, to confirm these changes" /></div> : <span className="text-[12.5px] text-px-muted">Every change is recorded in the audit log.</span>}
                <button className={pxPrimary}>Save changes</button>
              </div>
            </form>
          </PxPanel>
          {fixed[section] ? (
            <PxPanel title="Set outside this page" description="Shown for reference. These cannot be changed here.">
              {fixed[section]!.map(([label, value, help]) => <SettingsRow key={label} label={label} help={help}><Fixed>{value}</Fixed></SettingsRow>)}
            </PxPanel>
          ) : null}
          {RELATED[section] ? (
            <p className="text-[13px] text-px-muted">Related: {RELATED[section]!.map(([href, label], i) => <span key={href}>{i ? " · " : ""}<Link href={href}>{label}</Link></span>)}</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
