"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { List, X } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/** Phone and tablet menu: a hamburger button that slides the full sidebar in from the left. */
export function MobileNav({ children, header, footer }: { children: ReactNode; header: ReactNode; footer: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger aria-label="Open menu" data-testid="mobile-menu" className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-navy-900 hover:bg-slate-100 lg:hidden">
        <List size={24} aria-hidden="true" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-navy-950/50 backdrop-blur-[2px] lg:hidden" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[320px] flex-col bg-navy-950 text-slate-200 shadow-2xl lg:hidden">
          <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Go to another part of CSB</DialogPrimitive.Description>
          {header}
          <nav className="flex-1 space-y-5 overflow-y-auto overscroll-contain pb-4 pt-4" aria-label="Main">{children}</nav>
          {footer}
          <DialogPrimitive.Close aria-label="Close menu" className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-md text-navy-900 hover:bg-slate-100">
            <X size={22} aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
