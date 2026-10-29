"use client";
import { useEffect } from "react";

/** A load failure keeps the shell and offers a retry; the detail stays in the server log. */
export default function LibraryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    document.title = "Policy Library couldn't load · CSB";
  }, []);
  return (
    <div className="pl-root px-8 py-16 text-center">
      <h1 className="pl-serif text-[24px] font-semibold text-[#0b1530]">The Policy Library couldn&apos;t load</h1>
      <p className="mt-2 text-[14px] text-[#4f5b6c]">Something went wrong on our side. Your policies are unchanged.</p>
      <button type="button" onClick={reset} className="pl-btn-primary mt-5">Try again</button>
    </div>
  );
}
