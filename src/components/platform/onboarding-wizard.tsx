"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { provisionClientAction, type OnboardingState } from "@/app/platform-actions";

interface Plan { id: string; name: string; modules: string[]; includedUsers: number | null; includedBranches: number | null; storageMb: number | null; aiRequestsPerMonth: number | null; monthlyPricePence: number | null; annualPricePence: number | null }

const STEPS = ["Company details", "Subscription", "Customer administrator", "Review and provision"];
const SERVICE_TYPES = ["Domiciliary care", "Supported living", "Live-in care", "Extra care housing", "Residential care", "Nursing care", "Day services"];
const money = (p: number | null) => (p === null ? "price not set" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(p / 100));
const btn = "btn border-[1.5px] border-[#5b21b6] bg-[#5b21b6] text-white hover:bg-[#4c1d95] hover:text-white";
const btn2 = "btn border-[1.5px] border-[#c5cad6] bg-white text-[#26304a] hover:border-[#5b21b6]";

/**
 * Add New Client, one step at a time. All fields live in one form, so nothing typed is lost between steps or when the
 * server refuses a submission; the server validates everything again and creates the client in one transaction.
 */
export function OnboardingWizard({ onboardingKey, plans, modules, defaultModules, trialEnd, roles }: { onboardingKey: string; plans: Plan[]; modules: { key: string; name: string; summary: string }[]; defaultModules: string[]; trialEnd: string; roles: [string, string][] }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(provisionClientAction, {});
  const [step, setStep] = useState(0);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [chosenModules, setChosenModules] = useState<string[]>(defaultModules);
  const [trial, setTrial] = useState(true);
  const [summary, setSummary] = useState<[string, string][]>([]);
  const form = useRef<HTMLFormElement>(null);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const router = useRouter();
  const plan = plans.find((p) => p.id === planId);

  useEffect(() => {
    if (state.result) router.push(`/platform-admin/clients/new/done?org=${state.result.organisationId}${state.result.reused ? "&reused=1" : ""}`);
  }, [state.result, router]);
  useEffect(() => {
    if (state.error) setStep(3);
  }, [state.error]);

  function valid(i: number) {
    const el = sections.current[i];
    if (!el) return true;
    for (const input of Array.from(el.querySelectorAll<HTMLInputElement>("input, select, textarea"))) {
      if (!input.checkValidity()) {
        input.reportValidity();
        return false;
      }
    }
    return true;
  }
  function next() {
    if (!valid(step)) return;
    if (step === 2 && form.current) {
      const fd = new FormData(form.current);
      const v = (k: string) => String(fd.get(k) ?? "").trim();
      setSummary([
        ["Legal name", v("legalName")], ["Trading name", v("tradingName") || "—"], ["Company number", v("companyNumber") || "—"], ["Contact", [v("mainContactName"), v("contactEmail"), v("contactPhone")].filter(Boolean).join(" · ") || "—"],
        ["Plan", `${plan?.name ?? "—"} (${trial ? `trial until ${v("trialEndsAt")}` : "paid"}, ${v("billingPeriod") === "ANNUAL" ? "annual" : "monthly"})`],
        ["Modules", modules.filter((m) => chosenModules.includes(m.key)).map((m) => m.name).join(", ")],
        ["Branches", v("branches").split("\n").map((b) => b.trim()).filter(Boolean).join(", ") || "Main office"],
        ["First administrator", `${v("adminName")} <${v("adminEmail")}>`],
      ]);
    }
    setStep((s) => Math.min(3, s + 1));
  }
  function choosePlan(id: string) {
    setPlanId(id);
    const p = plans.find((x) => x.id === id);
    if (p?.modules.length) setChosenModules(p.modules);
  }

  const panel = "rounded-[8px] border border-[#e4e7ef] bg-white p-4";
  return (
    <form ref={form} action={action} className="space-y-4" noValidate={false}>
      <input type="hidden" name="onboardingKey" value={onboardingKey} />
      <ol aria-label="Steps" className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={`rounded-full px-3 py-1 text-[12.5px] ${i === step ? "bg-[#5b21b6] text-white" : i < step ? "bg-[#ede9fe] text-[#3b1a86]" : "bg-[#eceef2] text-[#46505f]"}`}>{i + 1}. {s}</li>
        ))}
      </ol>

      <section ref={(el) => { sections.current[0] = el; }} hidden={step !== 0} className={panel} aria-label="Company details">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label><span className="label">Legal company name *</span><input name="legalName" required minLength={2} className="input" /></label>
          <label><span className="label">Trading name</span><input name="tradingName" className="input" /></label>
          <label><span className="label">Company registration number</span><input name="companyNumber" pattern="[A-Za-z0-9]{6,10}" title="6 to 10 letters and numbers" className="input" /></label>
          <label><span className="label">Country and jurisdiction</span><input name="country" defaultValue="England" className="input" /></label>
          <label className="md:col-span-2"><span className="label">Main business address</span><textarea name="address" rows={2} className="input" /></label>
          <label><span className="label">Main contact person</span><input name="mainContactName" className="input" /></label>
          <label><span className="label">Contact email</span><input type="email" name="contactEmail" className="input" /></label>
          <label><span className="label">Contact telephone</span><input name="contactPhone" pattern="[0-9 +()\-]{6,30}" className="input" /></label>
          <label><span className="label">CQC provider ID</span><input name="cqcProviderId" pattern="[0-9]-[0-9]{6,12}" placeholder="1-123456789" className="input" /></label>
          <label className="md:col-span-2"><span className="label">CQC location IDs (separate with commas)</span><input name="cqcLocationIds" className="input" /></label>
          <fieldset className="md:col-span-2"><legend className="label">Service types</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">{SERVICE_TYPES.map((t) => <label key={t} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="serviceTypes" value={t} defaultChecked={t === "Domiciliary care"} />{t}</label>)}</div>
          </fieldset>
          <label className="md:col-span-2"><span className="label">Branches (one per line; empty means a single &quot;Main office&quot;)</span><textarea name="branches" rows={3} className="input" /></label>
        </div>
        <p className="mt-2 text-[12.5px] text-[#5b6478]">A CQC ID is recorded as given. It is not proof of registration until someone checks it on the CQC register.</p>
      </section>

      <section ref={(el) => { sections.current[1] = el; }} hidden={step !== 1} className={panel} aria-label="Subscription">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="md:col-span-2"><span className="label">Plan *</span>
            <select name="planId" required value={planId} onChange={(e) => choosePlan(e.target.value)} className="input">{plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({money(p.monthlyPricePence)} a month)</option>)}</select>
          </label>
          <fieldset className="md:col-span-2"><legend className="label">Trial or paid</legend>
            <label className="mr-4 inline-flex items-center gap-2 text-[13.5px]"><input type="radio" name="status" value="TRIAL" checked={trial} onChange={() => setTrial(true)} />Trial</label>
            <label className="inline-flex items-center gap-2 text-[13.5px]"><input type="radio" name="status" value="ACTIVE" checked={!trial} onChange={() => setTrial(false)} />Paid</label>
          </fieldset>
          {trial ? <label><span className="label">Trial ends *</span><input type="date" name="trialEndsAt" required defaultValue={trialEnd} className="input" /></label> : null}
          <label><span className="label">Billing period</span><select name="billingPeriod" className="input"><option value="MONTHLY">Monthly</option><option value="ANNUAL">Annual</option></select></label>
          <label><span className="label">Renewal date</span><input type="date" name="renewsAt" className="input" /></label>
          <label><span className="label">User allowance</span><input type="number" min={0} name="userAllowance" placeholder={plan?.includedUsers?.toString() ?? "Unlimited"} className="input" /></label>
          <label><span className="label">Storage allowance (MB)</span><input type="number" min={0} name="storageMb" placeholder={plan?.storageMb?.toString() ?? "Unlimited"} className="input" /></label>
          <label><span className="label">AI requests per month</span><input type="number" min={0} name="aiRequestsPerMonth" placeholder={plan?.aiRequestsPerMonth?.toString() ?? "None set"} className="input" /></label>
          <fieldset className="md:col-span-2"><legend className="label">Enabled modules</legend>
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {modules.map((m) => (
                <label key={m.key} className="flex items-start gap-2 text-[13.5px]">
                  <input type="checkbox" name="modules" value={m.key} className="mt-1" checked={chosenModules.includes(m.key)} onChange={(e) => setChosenModules((c) => (e.target.checked ? [...c, m.key] : c.filter((x) => x !== m.key)))} />
                  <span><span className="font-medium">{m.name}</span><span className="block text-[12px] text-[#5b6478]">{m.summary}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <p className="mt-2 text-[12.5px] text-[#5b6478]">Empty allowances follow the plan. No payment is taken: billing is not connected.</p>
      </section>

      <section ref={(el) => { sections.current[2] = el; }} hidden={step !== 2} className={panel} aria-label="Customer administrator">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label><span className="label">Administrator name *</span><input name="adminName" required minLength={2} className="input" /></label>
          <label><span className="label">Administrator email *</span><input type="email" name="adminEmail" required className="input" /></label>
          <label><span className="label">Job title</span><input name="adminJobTitle" className="input" /></label>
          <fieldset><legend className="label">Organisation roles</legend>
            <div className="grid grid-cols-1 gap-1">{roles.map(([v, l]) => <label key={v} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="adminRoles" value={v} defaultChecked={v === "ORG_ADMIN" || v === "CARE_MANAGER" || v === "COMPLIANCE_LEAD"} disabled={false} />{l}</label>)}</div>
          </fieldset>
        </div>
        <p className="mt-2 text-[12.5px] text-[#5b6478]">They receive a secure, single-use invitation link and choose their own password. Organisation admin is required.</p>
      </section>

      <section hidden={step !== 3} className={panel} aria-label="Review and provision">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13.5px] md:grid-cols-[200px_minmax(0,1fr)]">
          {summary.map(([k, v]) => <div key={k} className="contents"><dt className="text-[#5b6478]">{k}</dt><dd className="break-words">{v}</dd></div>)}
        </dl>
        {state.error ? <p role="alert" className="mt-3 rounded-[6px] border-l-4 border-rose-300 bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800">{state.error}</p> : null}
        <p className="mt-3 text-[12.5px] text-[#5b6478]">Provisioning creates the organisation, its reference, branches, subscription, modules, the invitation and an audit entry together. If anything fails, nothing is created.</p>
      </section>

      <div className="flex flex-wrap gap-2">
        {step > 0 ? <button type="button" className={btn2} onClick={() => setStep((s) => s - 1)} disabled={pending}>Back</button> : null}
        {step < 3 ? <button type="button" className={btn} onClick={next}>Continue</button> : <button className={btn} disabled={pending}>{pending ? "Provisioning…" : "Provision client"}</button>}
      </div>
    </form>
  );
}
