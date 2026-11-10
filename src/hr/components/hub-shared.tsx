import type { ReactNode } from "react";
import { ModuleHeader } from "@/components/module-header-band";
import type { OrganisationSettings, State, User } from "@/hr/lib/domain";

/** Types and small helpers shared by the HR Hub's screens (split out of hub.tsx so each screen can live in its own file). */
export type Data = Omit<State, "settings"> & {
  settings: OrganisationSettings;
  allBranches: boolean;
  user: User;
  today: string;
  signIns?: string[];
};
export type Mutate = (body: unknown) => Promise<Record<string, unknown>>;
export const formatDate = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/London",
      }).format(new Date(s.length === 10 ? s + "T12:00:00Z" : s))
    : "Not set";
export function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  // The shared module band (owner's colour redesign, 10 Nov 2026).
  return <ModuleHeader title={title} description={subtitle} actions={action} module="hr" />;
}
