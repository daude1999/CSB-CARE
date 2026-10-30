"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
import type { ReactNode } from "react";

/** A button that opens a small modal holding a form. Keeps rarely used inputs out of the page. */
export function ActionDialog({ trigger, title, description, children, triggerClassName = "btn-primary" }: { trigger: ReactNode; title: string; description?: string; children: ReactNode; triggerClassName?: string }) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger className={triggerClassName}>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-40 bg-navy-950/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="dialog-panel fixed left-1/2 top-[18vh] z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-md border-t-[3px] border-teal-400 bg-white p-6 shadow-2xl">
          <DialogPrimitive.Title className="font-serif text-xl font-semibold text-navy-900">{title}</DialogPrimitive.Title>
          {description ? <DialogPrimitive.Description className="mt-1.5 text-sm leading-6 text-slate-600">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          <div className="mt-5">{children}</div>
          <DialogPrimitive.Close aria-label="Close" className="absolute right-3 top-3 rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-navy-900">
            <X size={16} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
