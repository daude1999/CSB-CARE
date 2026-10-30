"use client";
import { startTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/link";
import { TitleBar } from "@/components/title-bar";

/**
 * A page that failed to load keeps the shell (sidebar, top bar) and offers a real retry: the page is fetched
 * from the server again, not just redrawn from what failed.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <>
      <TitleBar title="This page couldn't load" />
      <div role="alert" className="panel rounded-t-none">
        <p className="text-[15px] text-slate-700">
          {error.message?.includes("not found") ? error.message : "Something went wrong on our side and the error has been logged. Nothing you entered has been lost."}{" "}
          {error.digest ? <span className="text-xs text-slate-500">Ref: {error.digest}</span> : null}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={retry}>Try again</button>
          <Link className="btn-secondary" href="/overview">Back to overview</Link>
        </div>
      </div>
    </>
  );
}
