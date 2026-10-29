import type { ReactNode } from "react";
import { FileText } from "@phosphor-icons/react/dist/ssr";
import { STATUS_LABELS, type StatusKey } from "@/server/policies/library-view";

const PILL: Record<StatusKey, string> = {
  published: "bg-[#d6fcee] text-[#157a3e]",
  not_approved: "bg-[#eef0f3] text-[#4a5564]",
  draft: "bg-[#f1ecfb] text-[#5b3fa8]",
  under_review: "bg-[#e4f0fe] text-[#0454d8]",
  review_due: "bg-[#fef1d7] text-[#b2510d]",
  overdue: "bg-[#fde4e4] text-[#b42318]",
};

const TIP: Record<StatusKey, string> = {
  published: "The live version has been approved and published",
  not_approved: "CSB starter text that your organisation has not yet approved",
  draft: "Not yet published",
  under_review: "A revision has been submitted and is waiting for a decision",
  review_due: "The next review is due within 60 days",
  overdue: "The review date has passed",
};

export function StatusPill({ status, className = "" }: { status: StatusKey; className?: string }) {
  return <span title={TIP[status]} className={`inline-flex h-[21px] items-center whitespace-nowrap rounded-[4px] px-[7px] text-[12px] font-medium ${PILL[status]} ${className}`}>{STATUS_LABELS[status]}</span>;
}

/** The document tile: blue for documents in order, amber when a review is due or overdue. */
export function DocTile({ status, size = 48 }: { status: StatusKey; size?: number }) {
  const warn = status === "review_due" || status === "overdue";
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className={`flex shrink-0 items-center justify-center rounded-[8px] border ${warn ? "border-[#f6e3c6] bg-[#fdf3e4] text-[#933f16]" : "border-[#dfe8f0] bg-[#ebf2f7] text-[#154e96]"}`}>
      <FileText size={Math.round(size * 0.5)} weight="regular" />
    </span>
  );
}

export function Initials({ name, size = 22 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} className="flex shrink-0 items-center justify-center rounded-full bg-[#0f2a4f] font-semibold text-white">
      {initials}
    </span>
  );
}

export function fmtShort(d: Date | null | undefined) {
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "—";
}

/** "in 5 months", "3 weeks ago": how far away a review date is. */
export function relative(d: Date, now = new Date()) {
  const days = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  const abs = Math.abs(days);
  const unit = abs >= 60 ? `${Math.round(abs / 30.44)} months` : abs >= 14 ? `${Math.round(abs / 7)} weeks` : abs === 1 ? "1 day" : `${abs} days`;
  if (days === 0) return "today";
  return days > 0 ? unit : `${unit} ago`;
}

export function Panel({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return <section aria-label={label} className={`pl-panel ${className}`}>{children}</section>;
}
