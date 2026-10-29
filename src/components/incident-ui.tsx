import type { IncidentSeverity, IncidentStatus } from "@prisma/client";
import { Badge, type Tone } from "@/components/ui";

const SEVERITY: Record<IncidentSeverity, { label: string; tone: Tone }> = { LOW: { label: "Low", tone: "slate" }, MODERATE: { label: "Moderate", tone: "amber" }, HIGH: { label: "High", tone: "rose" }, CRITICAL: { label: "Critical", tone: "rose" } };
const STATUS: Record<IncidentStatus, { label: string; tone: Tone }> = { OPEN: { label: "Open", tone: "amber" }, INVESTIGATING: { label: "Investigating", tone: "teal" }, CLOSED: { label: "Closed", tone: "green" } };

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return <Badge tone={SEVERITY[severity].tone}>{SEVERITY[severity].label}</Badge>;
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}
