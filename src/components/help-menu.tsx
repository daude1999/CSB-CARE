"use client";
import Link from "@/components/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Archive, ChatTeardropText, ChatsCircle, Question } from "@phosphor-icons/react";

/**
 * Help & Resources, from the question mark in the top bar: the Resource Centre, the registered manager interview
 * preparation and (for people who may use it) the AI assistant. These are guidance, not modules, so they live here
 * rather than in a module's side menu. The menu closes when a page opens, on Escape and on a click outside it.
 */
export function HelpMenu({ assistant, dark = false }: { assistant: boolean; dark?: boolean }) {
  const ref = useDismissableDetails();
  const row = "flex items-start gap-3 px-3 py-2.5 text-[14px] text-[#0b1530] no-underline hover:bg-slate-100 hover:text-[#0b1530]";
  return (
    <details ref={ref} className="relative" data-testid="help-menu">
      <summary aria-label="Help and resources" title="Help and resources" className={`flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full [&::-webkit-details-marker]:hidden ${dark ? "text-white hover:bg-white/10" : "text-[#0b1530] hover:bg-black/5"}`}>
        <Question size={23} aria-hidden="true" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-[290px] overflow-hidden rounded-[8px] border border-slate-200 bg-white py-1 shadow-lg">
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Help &amp; Resources</p>
        <Link href="/resource-centre" className={row}>
          <Archive size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[#1f5fd1]" />
          <span><span className="block font-medium">Resource Centre</span><span className="block text-[12.5px] text-slate-600">Registration pack, templates and guidance</span></span>
        </Link>
        <Link href="/interview-prep" className={row}>
          <ChatsCircle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[#1f5fd1]" />
          <span><span className="block font-medium">Interview Prep</span><span className="block text-[12.5px] text-slate-600">Registered manager interview guidance</span></span>
        </Link>
        {assistant ? (
          <Link href="/assistant" className={row}>
            <ChatTeardropText size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[#1f5fd1]" />
            <span><span className="block font-medium">AI Assistant</span><span className="block text-[12.5px] text-slate-600">Ask about your policies</span></span>
          </Link>
        ) : null}
      </div>
    </details>
  );
}

/** A <details> menu that closes when a page opens, on Escape (returning focus to its button) and on a click outside it. */
export function useDismissableDetails() {
  const ref = useRef<HTMLDetailsElement>(null);
  const path = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) {
        el.open = false;
        if (e instanceof KeyboardEvent) el.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return ref;
}
