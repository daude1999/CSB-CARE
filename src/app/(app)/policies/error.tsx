"use client";
import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ModuleHeader } from "@/components/module-header-band";

/** A load failure keeps the shell and offers a retry; the detail stays in the server log. */
export default function LibraryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  useEffect(() => {
    document.title = "Policy Library couldn't load · CSB";
  }, []);
  return (
    <>
      <ModuleHeader title="The Policy Library couldn't load" page="Policy Library" />
      <div role="alert" className="panel text-center">
        <p className="text-[14px] text-[#4f5b6c]">Something went wrong on our side. Your policies are unchanged.</p>
        <button type="button" onClick={retry} className="btn-primary mt-5">Try again</button>
      </div>
    </>
  );
}
