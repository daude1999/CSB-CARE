"use server";

import { cookies, headers } from "next/headers";
import { handle, handleData, str } from "./action-kit";
import { PLATFORM_LINK_COOKIE } from "./platform-link";
import { addClientBranch, markCqcChecked, updateCompanyDetails } from "@/server/platform/customers";
import { provisionClient, type OnboardingResult } from "@/server/platform/onboarding";
import {
  deactivateAccount, deactivateMembershipAsPlatform, emailResetLink, inviteAsPlatform, platformResetLink, reactivateAccount, reactivateMembershipAsPlatform,
  requirePasswordReset, revokeAllSessions, revokeInviteAsPlatform, revokeResetLink, revokeResetLinks, revokeSession, setPlatformRoles, updateMembershipAsPlatform,
} from "@/server/platform/accounts";
import { setClientModule, setClientModuleLimits } from "@/server/platform/modules";
import { changeSubscription, extendTrial, savePlan, setCustomerStatus } from "@/server/platform/subscriptions";
import { coerceSetting, isSettingKey, recordRestoreTest, SETTINGS, updateSettings, type SettingGroup, type SettingKey } from "@/server/platform/settings";
import { decideSupportAccess, emergencySupportAccess, requestSupportAccess, revokeSupportAccess } from "@/server/platform/support";
import { ValidationError } from "@/lib/errors";
import { isModuleKey } from "@/lib/platform-modules";
import { ROLES } from "@/server/admin/users";
import type { OrgRole } from "@prisma/client";

/**
 * Server actions of the Evantix Platform Admin Centre. Each reads the form, calls one src/server/platform function with
 * the session's context (which checks platform permission itself) and redirects back with ?ok= or ?error=.
 * Organisation ids here name the client being administered; the platform permission, not the form, authorises it.
 */

const ids = (fd: FormData, k: string) => fd.getAll(k).filter((x): x is string => typeof x === "string" && x.length > 0);
const moduleIds = (fd: FormData) => ids(fd, "modules").filter(isModuleKey);
const roleIds = (fd: FormData, k: string) => ids(fd, k).filter((r): r is OrgRole => (ROLES as readonly string[]).includes(r));
const optStr = (fd: FormData, k: string) => str(fd, k) || null;
function optInt(fd: FormData, k: string): number | null {
  const v = str(fd, k);
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ValidationError("Use whole numbers");
  return n;
}
function optDate(fd: FormData, k: string): Date | null {
  const v = str(fd, k);
  if (!v) return null;
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ValidationError("Give dates as day, month and year");
  return d;
}
/** Pounds typed by a person (e.g. "149.00") into pence. */
function optPence(fd: FormData, k: string): number | null {
  const v = str(fd, k).replace(/[£,\s]/g, "");
  if (!v) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new ValidationError("Give prices in pounds, like 149 or 149.50");
  return Math.round(Number(v) * 100);
}

async function origin() {
  const h = await headers();
  return process.env.APP_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}
async function showLinkOnce(token: string) {
  const o = await origin();
  (await cookies()).set(PLATFORM_LINK_COOKIE, `${o}/account/${token}`, { httpOnly: true, sameSite: "strict", secure: o.startsWith("https"), path: "/platform-admin", maxAge: 120 });
}

// ── Clients ─────────────────────────────────────────────────────────────

const company = (fd: FormData) => ({
  legalName: str(fd, "legalName"),
  tradingName: optStr(fd, "tradingName"),
  companyNumber: optStr(fd, "companyNumber"),
  address: optStr(fd, "address"),
  contactEmail: optStr(fd, "contactEmail"),
  contactPhone: optStr(fd, "contactPhone"),
  country: str(fd, "country") || "England",
  mainContactName: optStr(fd, "mainContactName"),
  serviceTypes: ids(fd, "serviceTypes"),
  cqcProviderId: optStr(fd, "cqcProviderId"),
  cqcLocationIds: str(fd, "cqcLocationIds").split(/[\s,]+/).filter(Boolean),
});

export async function updateCompanyAction(fd: FormData) {
  return handle(fd, (ctx) => updateCompanyDetails(ctx, str(fd, "organisationId"), company(fd)), "Company details saved");
}

export async function markCqcCheckedAction(fd: FormData) {
  return handle(fd, (ctx) => markCqcChecked(ctx, str(fd, "organisationId")), "CQC provider ID marked as checked");
}

export async function addClientBranchAction(fd: FormData) {
  return handle(fd, async (ctx) => { await addClientBranch(ctx, str(fd, "organisationId"), { name: str(fd, "name"), address: optStr(fd, "address"), cqcLocationId: optStr(fd, "cqcLocationId") }); }, "Branch added");
}

export async function customerStatusAction(fd: FormData) {
  const action = str(fd, "statusAction");
  const words: Record<string, string> = { suspend: "Client suspended. Its staff now see a suspended notice; no data was deleted.", reinstate: "Client reinstated", close: "Client closed. No data was deleted.", reopen: "Client reopened" };
  return handle(fd, async (ctx) => {
    if (!(action in words)) throw new ValidationError("Choose what to do");
    await setCustomerStatus(ctx, str(fd, "organisationId"), action as "suspend", str(fd, "reason"), fd.get("confirmPassword")?.toString());
  }, words[action] ?? "Saved");
}

export type OnboardingState = { error?: string; result?: OnboardingResult };

/** Add New Client. Returns the outcome to the wizard (no redirect) so a refused submission keeps everything typed. */
export async function provisionClientAction(_prev: OnboardingState, fd: FormData): Promise<OnboardingState> {
  const r = await handleData(async (ctx) => {
    const trial = str(fd, "status") === "TRIAL";
    const result = await provisionClient(ctx, {
      onboardingKey: str(fd, "onboardingKey"),
      company: company(fd),
      subscription: {
        planId: str(fd, "planId"),
        status: trial ? "TRIAL" : "ACTIVE",
        billingPeriod: str(fd, "billingPeriod") === "ANNUAL" ? "ANNUAL" : "MONTHLY",
        trialEndsAt: trial ? optDate(fd, "trialEndsAt") : null,
        renewsAt: optDate(fd, "renewsAt"),
        userAllowance: optInt(fd, "userAllowance"),
        branchAllowance: optInt(fd, "branchAllowance"),
        storageMb: optInt(fd, "storageMb"),
        aiRequestsPerMonth: optInt(fd, "aiRequestsPerMonth"),
      },
      modules: moduleIds(fd),
      admin: { name: str(fd, "adminName"), email: str(fd, "adminEmail"), jobTitle: optStr(fd, "adminJobTitle"), roles: roleIds(fd, "adminRoles") },
      branches: str(fd, "branches").split("\n").map((b) => b.trim()).filter(Boolean),
    });
    if (result.token) await showLinkOnce(result.token);
    return result;
  }, { revalidate: true });
  return r.ok ? { result: r.data } : { error: r.error };
}

// ── Users and accounts ──────────────────────────────────────────────────

export async function platformResetAction(fd: FormData) {
  const delivery = str(fd, "delivery") === "email" ? "email" : "show";
  return handle(fd, async (ctx) => {
    const r = await platformResetLink(ctx, str(fd, "userId"), { delivery });
    if (r.emailed) {
      const { db } = await import("@/lib/db");
      const u = await db.user.findUniqueOrThrow({ where: { id: str(fd, "userId") } });
      await emailResetLink(u.email, u.name, `${await origin()}/account/${r.token}`, r.expiresInHours);
      return { ok: `Password reset link emailed to ${u.email}. It works once, for ${r.expiresInHours} hours.` };
    }
    await showLinkOnce(r.token);
    return { ok: `Password reset link created. Copy it below; it works once, for ${r.expiresInHours} hours.` };
  }, "Done");
}

export async function requireResetAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await requirePasswordReset(ctx, str(fd, "userId"), str(fd, "reason"));
    await showLinkOnce(r.token);
  }, "A new password is now required. The person was signed out; give them the link below.");
}

export async function revokeSessionsAction(fd: FormData) {
  return handle(fd, async (ctx) => ({ ok: `Signed out of ${await revokeAllSessions(ctx, str(fd, "userId"), str(fd, "reason"))} session(s)` }), "Signed out");
}

export async function revokeSessionAction(fd: FormData) {
  return handle(fd, (ctx) => revokeSession(ctx, str(fd, "sessionId")), "Session ended");
}

export async function revokeResetLinksAction(fd: FormData) {
  return handle(fd, async (ctx) => ({ ok: `${await revokeResetLinks(ctx, str(fd, "userId"))} unused reset link(s) revoked` }), "Revoked");
}

export async function revokeResetLinkAction(fd: FormData) {
  return handle(fd, (ctx) => revokeResetLink(ctx, str(fd, "tokenId")), "Reset link revoked");
}

export async function deactivateAccountAction(fd: FormData) {
  return handle(fd, (ctx) => deactivateAccount(ctx, str(fd, "userId"), str(fd, "reason"), fd.get("confirmPassword")?.toString() ?? ""), "Account deactivated and signed out everywhere");
}

export async function reactivateAccountAction(fd: FormData) {
  return handle(fd, (ctx) => reactivateAccount(ctx, str(fd, "userId"), str(fd, "reason")), "Account reactivated");
}

export async function platformRolesAction(fd: FormData) {
  return handle(fd, (ctx) => setPlatformRoles(ctx, str(fd, "userId"), ids(fd, "platformRoles"), fd.get("confirmPassword")?.toString() ?? "", str(fd, "reason")), "Platform roles saved");
}

const memberInput = (fd: FormData) => ({ roles: ids(fd, "roles"), branchIds: ids(fd, "branchIds"), jobTitle: str(fd, "jobTitle") });

export async function platformMemberAction(fd: FormData) {
  return handle(fd, (ctx) => updateMembershipAsPlatform(ctx, str(fd, "organisationId"), str(fd, "membershipId"), memberInput(fd)), "Roles and branch access saved for this organisation only");
}

export async function platformDeactivateMemberAction(fd: FormData) {
  return handle(fd, (ctx) => deactivateMembershipAsPlatform(ctx, str(fd, "organisationId"), str(fd, "membershipId"), str(fd, "reason")), "Membership deactivated");
}

export async function platformReactivateMemberAction(fd: FormData) {
  return handle(fd, (ctx) => reactivateMembershipAsPlatform(ctx, str(fd, "organisationId"), str(fd, "membershipId")), "Membership reactivated with its previous roles");
}

export async function platformInviteAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await inviteAsPlatform(ctx, str(fd, "organisationId"), { ...memberInput(fd), email: str(fd, "email"), name: str(fd, "name") });
    await showLinkOnce(r.token);
  }, "Invitation created. Copy the link below.");
}

export async function platformRevokeInviteAction(fd: FormData) {
  return handle(fd, (ctx) => revokeInviteAsPlatform(ctx, str(fd, "organisationId"), str(fd, "inviteId")), "Invitation revoked");
}

// ── Commercial ──────────────────────────────────────────────────────────

export async function savePlanAction(fd: FormData) {
  return handle(fd, async (ctx) => { await savePlan(ctx, optStr(fd, "planId"), {
    code: str(fd, "code"),
    name: str(fd, "name"),
    description: optStr(fd, "description"),
    monthlyPricePence: optPence(fd, "monthlyPrice"),
    annualPricePence: optPence(fd, "annualPrice"),
    includedUsers: optInt(fd, "includedUsers"),
    includedBranches: optInt(fd, "includedBranches"),
    storageMb: optInt(fd, "storageMb"),
    aiRequestsPerMonth: optInt(fd, "aiRequestsPerMonth"),
    modules: moduleIds(fd),
    supportLevel: optStr(fd, "supportLevel"),
    addOns: str(fd, "addOns").split(",").map((a) => a.trim()).filter(Boolean),
    active: fd.get("active") === "on",
  }); }, "Plan saved");
}

export async function changeSubscriptionAction(fd: FormData) {
  return handle(fd, async (ctx) => { await changeSubscription(ctx, str(fd, "organisationId"), {
    planId: str(fd, "planId"),
    status: str(fd, "status") === "TRIAL" ? "TRIAL" : "ACTIVE",
    billingPeriod: str(fd, "billingPeriod") === "ANNUAL" ? "ANNUAL" : "MONTHLY",
    trialEndsAt: optDate(fd, "trialEndsAt"),
    renewsAt: optDate(fd, "renewsAt"),
    userAllowance: optInt(fd, "userAllowance"),
    branchAllowance: optInt(fd, "branchAllowance"),
    storageMb: optInt(fd, "storageMb"),
    aiRequestsPerMonth: optInt(fd, "aiRequestsPerMonth"),
    applyPlanModules: fd.get("applyPlanModules") === "on",
  }, str(fd, "reason")); }, "Subscription saved. The previous period is kept in the history.");
}

export async function extendTrialAction(fd: FormData) {
  return handle(fd, (ctx) => extendTrial(ctx, str(fd, "organisationId"), str(fd, "trialEndsAt"), str(fd, "reason")), "Trial extended");
}

export async function setModuleAction(fd: FormData) {
  const on = str(fd, "enabled") === "true";
  return handle(fd, (ctx) => setClientModule(ctx, str(fd, "organisationId"), str(fd, "moduleKey"), { enabled: on, reason: str(fd, "reason"), confirmName: str(fd, "confirmName") }), on ? "Module switched on" : "Module switched off. Its records are kept.");
}

export async function moduleLimitsAction(fd: FormData) {
  return handle(fd, (ctx) => setClientModuleLimits(ctx, str(fd, "organisationId"), str(fd, "moduleKey"), { monthlyRequests: optInt(fd, "monthlyRequests"), monthlySpendPence: optPence(fd, "monthlySpend") }), "Limits saved");
}

// ── Settings and support ────────────────────────────────────────────────

export async function updateSettingsAction(fd: FormData) {
  const group = str(fd, "group") as SettingGroup;
  return handle(fd, async (ctx) => {
    const values: Record<string, unknown> = {};
    for (const key of Object.keys(SETTINGS) as SettingKey[]) {
      if (SETTINGS[key].group !== group || !isSettingKey(key)) continue;
      if (SETTINGS[key].kind === "bool") values[key] = coerceSetting(key, fd.get(key)?.toString());
      else if (SETTINGS[key].kind === "modules") values[key] = coerceSetting(key, ids(fd, key));
      else if (fd.has(key)) values[key] = coerceSetting(key, fd.get(key)?.toString());
    }
    const r = await updateSettings(ctx, group, values, fd.get("confirmPassword")?.toString());
    return { ok: r.changed ? `${r.changed} setting(s) saved` : "Nothing changed" };
  }, "Saved");
}

export async function restoreTestAction(fd: FormData) {
  return handle(fd, (ctx) => recordRestoreTest(ctx, { testedOn: str(fd, "testedOn"), outcome: str(fd, "outcome"), notes: str(fd, "notes") }), "Restore test recorded");
}

const supportInput = (fd: FormData) => ({ purpose: str(fd, "purpose"), scopes: ids(fd, "scopes"), hours: Number(str(fd, "hours") || "0") });

export async function requestSupportAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await requestSupportAccess(ctx, str(fd, "organisationId"), supportInput(fd));
    return { ok: r.administratorsTold ? `Request sent to ${r.administratorsTold} administrator(s) of ${r.organisation}. Access starts only when one of them approves.` : `Request recorded, but ${r.organisation} has no active administrator to approve it.` };
  }, "Requested");
}

export async function emergencySupportAction(fd: FormData) {
  return handle(fd, async (ctx) => { await emergencySupportAccess(ctx, str(fd, "organisationId"), supportInput(fd), fd.get("confirmPassword")?.toString() ?? ""); }, "Emergency support access is open. The client's administrators have been told.");
}

export async function revokeSupportAction(fd: FormData) {
  return handle(fd, async (ctx) => { await revokeSupportAccess(ctx, str(fd, "grantId"), str(fd, "reason")); }, "Support access revoked");
}

/** Used on the customer's own Settings page by their organisation administrator. */
export async function decideSupportAction(fd: FormData) {
  const approve = str(fd, "decision") === "approve";
  return handle(fd, async (ctx) => { await decideSupportAccess(ctx, str(fd, "grantId"), approve); }, approve ? "Support access approved. It ends automatically at the time shown." : "Support access declined");
}

/** Forgets a one-time link as soon as the page showing it has loaded, so a reload or the back button cannot show it again. */
export async function forgetOneTimeLinkAction() {
  (await cookies()).set(PLATFORM_LINK_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/platform-admin", maxAge: 0 });
}
