import Link from "@/components/link";
import { fmtDate } from "@/components/ui";
import { EmptyRow, Table, Tone } from "./ui";
import type { securityAudit } from "@/server/platform/activity";

type Entries = Awaited<ReturnType<typeof securityAudit>>["entries"];

/** Audit entries: actor, action, time, target organisation and person, before and after, outcome and reason. */
export function AuditTable({ entries }: { entries: Entries }) {
  return (
    <Table label="Audit log" minWidth={900} head={["When", "Event", "Organisation", "By", "Details", "Outcome"]} empty={entries.length ? null : <EmptyRow>No events match.</EmptyRow>}>
      {entries.map((e) => (
        <tr key={e.id}>
          <td className="whitespace-nowrap tabular-nums">{fmtDate(e.at, true)}</td>
          <td><Tone tone={e.tone}>{e.label}</Tone>{e.subject ? <span className="block text-meta"><Link href={`/platform-admin/users/${e.subjectId}`}>{e.subject}</Link></span> : null}</td>
          <td>{e.organisationId ? <Link href={`/platform-admin/clients/${e.organisationId}`}>{e.organisation}</Link> : <span className="text-px-muted">Platform</span>}</td>
          <td>{e.actorId ? <Link href={`/platform-admin/users/${e.actorId}`}>{e.actor}</Link> : e.actor}</td>
          <td className="max-w-[340px] text-meta text-px-muted">{e.reason ? <span className="block">Reason: {e.reason}</span> : null}{e.before !== null || e.after !== null ? <span className="block break-words font-mono text-caption">{JSON.stringify(e.before)} → {JSON.stringify(e.after)}</span> : null}</td>
          <td>{e.outcome === "Done" ? <span className="text-meta text-px-ok">Done</span> : <span className="text-meta text-px-danger">{e.outcome}</span>}</td>
        </tr>
      ))}
    </Table>
  );
}
