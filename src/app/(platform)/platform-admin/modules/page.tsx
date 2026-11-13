import { requireCtx } from "@/server/auth/current";
import { moduleCatalogue } from "@/server/platform/modules";
import { PxHeader, PxPanel, Table, Tone } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Modules" };

/** The licensed modules and how many clients use each. Switching happens per client, on its Modules tab. */
export default async function ModulesPage() {
  const ctx = await requireCtx();
  const modules = await moduleCatalogue(ctx);
  return (
    <>
      <PxHeader title="Modules" description="Switch a module on or off for one client from that client's Modules tab. Access is enforced on the server, and switching off never deletes records." />
      <PxPanel flush>
        <div className="px-4">
          <Table label="Modules" minWidth={980} head={["Module", "What it covers", "On", "Off", "Usage limits", "If switched off"]} align={["left", "left", "right", "right", "left", "left"]}>
            {modules.map((m) => (
              <tr key={m.key}>
                <td className="font-medium text-px-ink">{m.name}{m.critical ? <span className="mt-1 block"><Tone tone="amber">Care-critical</Tone></span> : null}</td>
                <td className="max-w-[260px] text-meta text-px-body">{m.summary}</td>
                <td className="text-right tabular-nums">{m.clientsOn}</td>
                <td className="text-right tabular-nums">{m.clientsOff}</td>
                <td className="text-meta">{m.limits?.map((l) => l.label).join(", ") ?? <span className="text-px-subtle">—</span>}</td>
                <td className="max-w-[300px] text-meta text-px-muted">{m.consequence}</td>
              </tr>
            ))}
          </Table>
        </div>
      </PxPanel>
    </>
  );
}
