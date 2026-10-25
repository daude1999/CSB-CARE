"use client";
// Modal for short forms, built on UIAble's dialog component (MIT, codedthemes/uiable).
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/uiable/dialog";

/** A button that opens a small modal holding a form. Keeps rarely used inputs out of the page. */
export function ActionDialog({ trigger, title, description, children, triggerClassName = "btn-primary" }: { trigger: ReactNode; title: string; description?: string; children: ReactNode; triggerClassName?: string }) {
  return (
    <Dialog>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent className="rounded-md border-t-[3px] border-teal-400 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl font-semibold text-navy-900">{title}</DialogTitle>
          <DialogDescription className={description ? "text-sm leading-6 text-slate-600" : "sr-only"}>{description ?? title}</DialogDescription>
        </DialogHeader>
        <div>{children}</div>
      </DialogContent>
    </Dialog>
  );
}
