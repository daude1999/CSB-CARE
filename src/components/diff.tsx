import type { SectionDiff } from "@/server/policies/versions";
import type { WordDiffPart } from "@/server/changes/diff";
import { Badge } from "./ui";

export function InlineDiff({ parts }: { parts: WordDiffPart[] }) {
  return (
    <p className="prose-policy">
      {parts.map((p, i) =>
        p.added ? (
          <ins key={i} className="rounded-sm bg-emerald-100 px-0.5 text-emerald-900 no-underline">{p.value}</ins>
        ) : p.removed ? (
          <del key={i} className="rounded-sm bg-rose-100 px-0.5 text-rose-800">{p.value}</del>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </p>
  );
}

export function PolicyDiffView({ diff, showUnchanged = false }: { diff: SectionDiff[]; showUnchanged?: boolean }) {
  const changed = diff.filter((d) => d.status !== "unchanged");
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        {changed.length} section(s) changed; {diff.length - changed.length} unchanged. <ins className="bg-emerald-100 px-1 no-underline">Added text</ins> <del className="bg-rose-100 px-1">removed text</del>
      </p>
      {diff
        .filter((d) => showUnchanged || d.status !== "unchanged")
        .map((d) => (
          <div key={d.key} data-testid={`diff-${d.key}`} className={`rounded-lg border p-4 ${d.status === "unchanged" ? "border-slate-100 bg-slate-50" : "border-amber-200 bg-white"}`}>
            <div className="mb-2 flex items-center gap-2">
              <h3>{d.heading}</h3>
              <Badge tone={d.status === "added" ? "green" : d.status === "removed" ? "rose" : d.status === "modified" ? "amber" : "slate"}>{d.status}</Badge>
              {d.isLocal ? <Badge tone="teal">customer-specific, never auto-edited</Badge> : null}
              {d.previousHeading ? <span className="text-xs text-slate-500">(was “{d.previousHeading}”)</span> : null}
            </div>
            <InlineDiff parts={d.parts} />
          </div>
        ))}
    </div>
  );
}
