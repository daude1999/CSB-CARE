"use client";

import "./globals.css";
import { Logo } from "@/components/brand";

/**
 * Shown when the signed-in shell itself could not load (its layout reads the session, organisation and notifications
 * from the database), which the in-shell error page cannot catch. Without it Next.js showed its bare "Application
 * error: a server-side exception has occurred". "Try again" reloads the whole page from the server.
 */
export default function AppShellError({ error }: { error: Error & { digest?: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f5f3] px-4 py-10">
      <div role="alert" className="w-full max-w-[480px] rounded-[10px] border border-[#e3e6ec] bg-white p-6 shadow-sm">
        <Logo className="h-10" />
        <h1 className="mt-5 text-title font-semibold text-[#0b1530]">The platform couldn&apos;t load just now</h1>
        <p className="mt-2 text-lead leading-[22px] text-slate-700">
          This is usually a brief connection problem on our side, for example straight after an update. Nothing you entered
          has been lost. Please try again in a few seconds.
        </p>
        {error.digest ? <p className="mt-2 text-xs text-slate-500">Ref: {error.digest}</p> : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Try again</button>
          <a className="btn-secondary" href="/overview">Back to overview</a>
        </div>
      </div>
    </main>
  );
}
