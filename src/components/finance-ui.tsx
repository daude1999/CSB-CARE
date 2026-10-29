import { Badge, type Tone } from "@/components/ui";

const SHEET: Record<string, { label: string; tone: Tone }> = { DRAFT: { label: "Draft", tone: "slate" }, SUBMITTED: { label: "Waiting for approval", tone: "amber" }, APPROVED: { label: "Approved", tone: "green" }, REJECTED: { label: "Rejected", tone: "rose" } };
const RUN: Record<string, { label: string; tone: Tone }> = { DRAFT: { label: "Draft", tone: "amber" }, APPROVED: { label: "Approved", tone: "green" }, VOID: { label: "Void", tone: "slate" } };

export function TimesheetBadge({ status }: { status: string }) {
  return <Badge tone={SHEET[status]?.tone ?? "slate"}>{SHEET[status]?.label ?? status}</Badge>;
}

export function RunBadge({ status }: { status: string }) {
  return <Badge tone={RUN[status]?.tone ?? "slate"}>{RUN[status]?.label ?? status}</Badge>;
}

export const hours = (minutes: number) => (minutes / 60).toFixed(2);
