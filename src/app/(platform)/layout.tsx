import "../globals.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { hasPlatformPermission } from "@/server/auth/rbac";
import { getSetting } from "@/server/platform/settings";
import { logoutAction } from "../actions";
import { PlatformNav, type NavGroup } from "@/components/platform/nav";

export const metadata: Metadata = { title: { default: "Platform Administration", template: "%s | Evantix Platform Administration" } };

const NAV: NavGroup[] = [
  { title: "Overview", items: [{ href: "/platform-admin", label: "Dashboard", exact: true }] },
  { title: "Customers", items: [
    { href: "/platform-admin/clients", label: "All Clients", exact: true },
    { href: "/platform-admin/clients/new", label: "Add New Client" },
    { href: "/platform-admin/onboarding", label: "Client Onboarding" },
    { href: "/platform-admin/administrators", label: "Client Administrators" },
  ] },
  { title: "Accounts & Security", items: [
    { href: "/platform-admin/users", label: "All Users" },
    { href: "/platform-admin/passwords", label: "Password Management" },
    { href: "/platform-admin/roles", label: "Roles & Permissions" },
    { href: "/platform-admin/sessions", label: "Login Sessions" },
    { href: "/platform-admin/security", label: "Security Audit" },
  ] },
  { title: "Commercial", items: [
    { href: "/platform-admin/subscriptions", label: "Subscriptions" },
    { href: "/platform-admin/plans", label: "Plans & Pricing" },
    { href: "/platform-admin/billing", label: "Billing & Invoices" },
    { href: "/platform-admin/renewals", label: "Trials & Renewals" },
  ] },
  { title: "Platform", items: [
    { href: "/platform-admin/modules", label: "Modules & Features" },
    { href: "/platform-admin/ai", label: "AI Management" },
    { href: "/platform-admin/storage", label: "Storage & Infrastructure" },
    { href: "/platform-admin/jobs", label: "Background Jobs" },
    { href: "/platform-admin/health", label: "Platform Health" },
  ] },
  { title: "Administration", items: [
    { href: "/platform-admin/settings", label: "Platform Settings" },
    { href: "/platform-admin/notifications", label: "Notifications" },
    { href: "/platform-admin/support", label: "Support & Access" },
    { href: "/platform-admin/activity", label: "Activity History" },
  ] },
];

/**
 * The Evantix Platform Admin Centre shell. Only Evantix platform administrators reach it: everyone else, including a
 * customer's own organisation administrators, gets "not found", and every page and action checks again on the server.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (!hasPlatformPermission(ctx, "platform.view")) notFound();
  const [name, notice] = await Promise.all([getSetting("general.platformName"), getSetting("maintenance.notice")]);
  const initials = ctx.userName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  const brand = (
    <Link href="/platform-admin" className="block no-underline" aria-label={`${name} Platform Administration home`}>
      <span className="block text-[17px] font-bold uppercase tracking-[0.18em] text-white">{name}</span>
      <span className="block whitespace-nowrap text-[11.5px] font-medium tracking-[0.04em] text-[#a78bfa]">Platform Administration</span>
    </Link>
  );
  return (
    <div className="flex min-h-screen bg-[#f5f6fa] text-[#0f1b3d]" data-testid="platform-admin">
      <a href="#px-main" className="sr-only z-50 rounded-[6px] bg-white px-3 py-2 text-[14px] focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <aside className="sticky top-0 hidden h-screen w-[244px] shrink-0 flex-col overflow-y-auto bg-[#0f1b3d] px-3 pb-4 pt-5 lg:flex">
        <div className="mb-6 px-3">{brand}</div>
        <PlatformNav groups={NAV} />
        <div className="mt-auto px-3 pt-6 text-[12px] text-[#8f9bbd]">
          <Link href="/overview" className="text-[#c9d1e6] no-underline hover:text-white hover:underline">Open the CSB care platform</Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex h-[60px] items-center gap-3 border-b border-[#0f1b3d] bg-[#0f1b3d] px-4 lg:border-[#e4e7ef] lg:bg-white lg:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            {brand}
            <PlatformNav groups={NAV} mobile />
          </div>
          <p className="hidden text-[13px] text-[#5b6478] lg:block">Evantix staff only. Customer care records are not available here.</p>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-right sm:block">
              <span className="block text-[13px] font-medium leading-4">{ctx.userName}</span>
              <span className="block text-[11.5px] leading-4 text-[#5b6478]">Platform administrator</span>
            </span>
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ede9fe] text-[12px] font-semibold text-[#3b1a86]">{initials}</span>
            <form action={logoutAction}>
              <button className="whitespace-nowrap rounded-[6px] border border-white/30 px-2.5 py-1 text-[13px] text-white hover:border-white lg:border-[#c5cad6] lg:text-[#26304a] lg:hover:border-[#6d28d9] lg:hover:text-[#3b1a86]">Sign out</button>
            </form>
          </div>
        </header>
        {notice ? <div role="status" className="border-b border-[#f3d38a] bg-[#fff8e6] px-4 py-2 text-[13.5px] text-[#6b4a00] lg:px-8">{notice}</div> : null}
        <main id="px-main" className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
