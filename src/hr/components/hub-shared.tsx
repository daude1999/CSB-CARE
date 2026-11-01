import type { ReactNode } from "react";
import type { OrganisationSettings, State, User } from "@/hr/lib/domain";

/** Types and small helpers shared by the HR Hub's screens (split out of hub.tsx so each screen can live in its own file). */
export type Data = Omit<State, "settings"> & {
  settings: OrganisationSettings;
  allBranches: boolean;
  user: User;
  today: string;
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
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
