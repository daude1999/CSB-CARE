import "../globals.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowSquareOut, CaretDown, MagnifyingGlass, Plus, SignOut, UserCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasPlatformPermission } from "@/server/auth/rbac";
import { getSetting } from "@/server/platform/settings";
import { logoutAction } from "../actions";
import { PlatformNav, WorkspaceTabs } from "@/components/platform/nav";
import { QuickSearch } from "@/components/platform/quick-search";

export const metadata: Metadata = { title: { default: "Platform Administration", template: "%s | Evantix Platform Administration" } };

const CREATE = [
  { href: "/platform-admin/clients/new", label: "Client", note: "Set up a customer organisation" },
  { href: "/platform-admin/plans?new=1", label: "Plan", note: "A subscription plan and allowances" },
  { href: "/platform-admin/administrators", label: "Administrator invitation", note: "For a client or for Evantix" },
  { href: "/platform-admin/passwords", label: "Password reset link", note: "For someone who is locked out" },
];

function environment() {
  const env = process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  return env === "production" ? { label: "Production", dot: "bg-[#1f9254]" } : env === "preview" ? { label: "Preview", dot: "bg-[#d48806]" } : { label: "Development", dot: "bg-[#9aa2b1]" };
}

/**
 * The Evantix Platform Admin Centre shell. Only Evantix platform administrators reach it: everyone else, including a
 * customer's own organisation administrators, gets "not found", and every page and action checks again on the server.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if (!hasPlatformPermission(ctx, "platform.view")) notFound();
  const [name, notice, supportWaiting] = await Promise.all([getSetting("general.platformName"), getSetting("maintenance.notice"), db.supportAccessGrant.count({ where: { status: "REQUESTED" } })]);
  const initials = ctx.userName.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const env = environment();
  const badges = { settings: supportWaiting };
  const mark = <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-px-accent text-[14px] font-bold text-white">{name.charAt(0)}</span>;
  return (
    <div className="px-scope flex min-h-screen bg-px-bg text-px-ink" data-testid="platform-admin">
      <a href="#px-main" className="sr-only z-50 rounded-[6px] bg-white px-3 py-2 text-[14px] focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <div className="hidden w-[64px] shrink-0 bg-px-nav md:block lg:w-[232px]">
      <aside className="sticky top-0 flex h-screen flex-col">
        <Link href="/platform-admin" className="flex h-14 shrink-0 items-center justify-center gap-2.5 border-b border-white/10 no-underline lg:justify-start lg:px-5" aria-label={`${name} Platform Administration home`}>
          {mark}
          <span className="hidden min-w-0 lg:block">
            <span className="block text-[14px] font-semibold leading-4 tracking-[0.02em] text-white">{name}</span>
            <span className="block text-[11.5px] leading-4 text-px-nav-muted">Admin Centre</span>
          </span>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 lg:px-3">
          <p className="mb-1.5 hidden px-3 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-px-nav-muted lg:block">Workspaces</p>
          <PlatformNav badges={badges} />
        </div>
        <div className="shrink-0 border-t border-white/10 px-2 py-3 lg:px-3">
          <Link href="/overview" title="Open the CSB care platform" className="flex items-center justify-center gap-2.5 rounded-[7px] px-3 py-2 text-[13px] text-px-nav-text no-underline hover:bg-px-nav-hover hover:text-white lg:justify-start">
            <ArrowSquareOut size={17} aria-hidden="true" /><span className="sr-only lg:not-sr-only">Care platform</span>
          </Link>
          <p className="mt-2 hidden items-center gap-2 px-3 text-[11.5px] text-px-nav-muted lg:flex"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${env.dot}`} />{env.label}</p>
        </div>
      </aside>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-px-line bg-px-nav px-3 md:bg-white md:px-4 lg:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <PlatformNav mobile badges={badges} />
            <Link href="/platform-admin" className="flex items-center gap-2 text-[14px] font-semibold text-white no-underline">{mark}{name}</Link>
          </div>
          <div className="hidden max-w-[440px] flex-1 md:block"><QuickSearch /></div>
          <div className="ml-auto flex items-center gap-1.5 md:gap-2">
            <Link href="/platform-admin/search" className="flex h-9 w-9 items-center justify-center rounded-[7px] text-white hover:bg-white/10 md:hidden" aria-label="Search">
              <MagnifyingGlass size={19} aria-hidden="true" />
            </Link>
            <details className="relative">
              <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-[7px] bg-px-accent px-2.5 text-[13.5px] font-medium text-white hover:bg-px-accent-hover sm:px-3 [&::-webkit-details-marker]:hidden" aria-label="Create">
                <Plus size={15} weight="bold" aria-hidden="true" /><span className="hidden sm:inline">New</span><CaretDown size={11} className="hidden sm:block" aria-hidden="true" />
              </summary>
              <div className="absolute right-0 z-40 mt-1.5 w-[260px] rounded-[10px] border border-px-line bg-white p-1 shadow-[0_12px_32px_-8px_rgba(15,27,61,0.25)]">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-px-subtle">Create</p>
                {CREATE.map((c) => (
                  <Link key={c.href} href={c.href} className="block rounded-[6px] px-3 py-2 no-underline hover:bg-px-accent-tint">
                    <span className="block text-[13.5px] font-medium text-px-ink">{c.label}</span>
                    <span className="block text-[12px] text-px-muted">{c.note}</span>
                  </Link>
                ))}
              </div>
            </details>
            <details className="relative">
              <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-[7px] px-1 md:hover:bg-px-row [&::-webkit-details-marker]:hidden" aria-label="Your account">
                <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-px-accent-soft text-[12px] font-semibold text-px-accent-strong">{initials}</span>
                <span className="hidden text-left xl:block">
                  <span className="block max-w-[180px] truncate text-[13px] font-medium leading-4 text-px-ink">{ctx.userName}</span>
                  <span className="block text-[11.5px] leading-4 text-px-muted">Platform administrator</span>
                </span>
                <CaretDown size={11} className="hidden text-px-muted xl:block" aria-hidden="true" />
              </summary>
              <div className="absolute right-0 z-40 mt-1.5 w-[240px] rounded-[10px] border border-px-line bg-white p-1 text-[13.5px] shadow-[0_12px_32px_-8px_rgba(15,27,61,0.25)]">
                <p className="border-b border-px-divider px-3 py-2 text-[12.5px] text-px-muted">Signed in as<span className="block truncate font-medium text-px-ink">{ctx.userName}</span></p>
                <Link href={`/platform-admin/users/${ctx.userId}`} className="mt-1 flex items-center gap-2 rounded-[6px] px-3 py-2 text-px-body no-underline hover:bg-px-accent-tint"><UserCircle size={16} aria-hidden="true" />Your account</Link>
                <Link href="/overview" className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-px-body no-underline hover:bg-px-accent-tint"><ArrowSquareOut size={16} aria-hidden="true" />Open the care platform</Link>
                <form action={logoutAction} className="mt-1 border-t border-px-divider pt-1">
                  <button className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-left text-px-danger hover:bg-px-danger-bg"><SignOut size={16} aria-hidden="true" />Sign out</button>
                </form>
              </div>
            </details>
          </div>
        </header>
        {notice ? <div role="status" className="border-b border-[#f3d38a] bg-[#fff8e6] px-4 py-2 text-[13.5px] text-[#6b4a00] lg:px-8">{notice}</div> : null}
        <WorkspaceTabs />
        <main id="px-main" className="w-full min-w-0 flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto max-w-[1440px]">{children}</div>
        </main>
        <footer className="border-t border-px-line px-4 py-3 text-[12px] text-px-subtle lg:px-8">
          <div className="mx-auto max-w-[1440px]">Evantix staff only. Customer care, medication and HR records are never shown in the Admin Centre.</div>
        </footer>
      </div>
    </div>
  );
}
