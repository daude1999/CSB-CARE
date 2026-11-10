"use client";
import { startTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/link";
import { pxPrimary, pxSecondary } from "@/components/platform/buttons";

/**
 * A Platform Admin Centre page that failed to load keeps the Admin Centre's own frame (sidebar, header, workspaces)
 * and offers a real retry: the page is fetched from the server again. Before this, a failure here fell through to the
 * whole-site error screen, which sends people to the care platform.
 */
export default function PlatformError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <div role="alert" className="rounded-[10px] border border-px-line bg-white p-6">
      <h1 className="text-[18px] font-semibold text-px-ink">This page couldn&apos;t load</h1>
      <p className="mt-2 max-w-[640px] text-[14px] leading-[22px] text-px-body">
        Something went wrong on our side and the error has been logged. Nothing was changed. Please try again; if it keeps happening, check Platform Health.{" "}
        {error.digest ? <span className="text-[12px] text-px-muted">Ref: {error.digest}</span> : null}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={retry} className={pxPrimary}>Try again</button>
        <Link href="/platform-admin" className={pxSecondary}>Admin Centre home</Link>
      </div>
    </div>
  );
}
