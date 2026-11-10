import Link from "@/components/link";
import { assignCarerAction } from "@/app/rota-actions";

/**
 * After a card is dragged to a team member and the eligibility service returns warnings, the move comes back here to be
 * confirmed. "Move anyway" sends the same assignment again with the warnings accepted; the service checks it again.
 * Shared by the Advanced Rota planner and the Daily Rota Board.
 */
export function MoveConfirm({ move, back }: { move: { visitId: string; slot: string; staffId: string; lockVersion: string; label: string; staff: string }; back: string }) {
  return (
    <section aria-label="Confirm move" className="panel mb-3 border-l-4 border-[#e3934a]">
      <p className="text-[14px]">Move <span className="font-medium">{move.label}</span> to <span className="font-medium">{move.staff}</span> anyway? The warnings above will be recorded on the allocation.</p>
      <form action={assignCarerAction} className="mt-2 flex gap-2">
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="visitId" value={move.visitId} />
        <input type="hidden" name="slot" value={move.slot} />
        <input type="hidden" name="staffId" value={move.staffId} />
        <input type="hidden" name="lockVersion" value={move.lockVersion} />
        <input type="hidden" name="acceptWarnings" value="true" />
        <button className="btn-primary">Move anyway</button>
        <Link href={back} className="btn-secondary">Leave it</Link>
      </form>
    </section>
  );
}
