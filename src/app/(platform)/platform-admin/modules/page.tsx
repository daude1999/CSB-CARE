import { requireCtx } from "@/server/auth/current";
import { moduleCatalogue } from "@/server/platform/modules";
import { PxHeader, PxPanel, Table, Tone } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Modules & Features" };

export default async function ModulesPage() {
  const ctx = await requireCtx();
  const modules = await moduleCatalogue(ctx);
  return (
    <>
      <PxHeader title="Modules & Features" description="The modules Evantix licenses. Switch a module on or off for one client from its profile (Modules tab). Access is enforced on the server, not only by hiding menus, and switching off never deletes records." />
      <PxPanel>
        <Table head={["Module", "What it covers", "Clients with it on", "Off for", "Usage limits", "If switched off"]}>
          {modules.map((m) => (
            <tr key={m.key}>
              <td className="font-medium">{m.name}{m.critical ? <span className="mt-0.5 block"><Tone tone="amber">Care-critical</Tone></span> : null}</td>
              <td className="max-w-[260px] text-[12.5px]">{m.summary}</td>
              <td className="tabular-nums">{m.clientsOn}</td>
              <td className="tabular-nums">{m.clientsOff}</td>
              <td className="text-[12.5px]">{m.limits?.map((l) => l.label).join(", ") ?? "—"}</td>
              <td className="max-w-[300px] text-[12.5px] text-[#46505f]">{m.consequence}</td>
            </tr>
          ))}
        </Table>
      </PxPanel>
    </>
  );
}
