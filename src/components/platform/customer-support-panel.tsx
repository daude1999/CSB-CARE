import type { Ctx } from "@/server/auth/rbac";
import { customerSupportAccess, SUPPORT_SCOPES, type SupportScope } from "@/server/platform/support";
import { decideSupportAction, revokeSupportAction } from "@/app/platform-actions";
import { fmtDate } from "@/components/ui";

/**
 * On a customer's own Settings page: Evantix support requests waiting for an answer, and support access active now.
 * Shown only when there is something to show; organisation administrators approve, decline or revoke here.
 */
export async function CustomerSupportPanel({ ctx }: { ctx: Ctx }) {
  const grants = await customerSupportAccess(ctx);
  if (!grants.length) return null;
  return (
    <section id="support-access" aria-labelledby="support-access-heading" className="mb-4 scroll-mt-24 rounded-[3px] border-l-4 border-[#7c3aed] bg-white px-5 pb-4 pt-4" data-testid="support-access">
      <h2 id="support-access-heading" className="text-[19px] font-normal text-slate-800">Evantix support access</h2>
      <p className="mb-3 text-[13px] text-slate-600">Evantix support can only see what you approve, for the time shown. They cannot sign in as your staff or open service user records.</p>
      <ul className="space-y-3">
        {grants.map((g) => (
          <li key={g.id} className="rounded-[4px] bg-slate-50 p-3 text-[14px]">
            <p className="font-medium">{g.status === "ACTIVE" ? `Active until ${fmtDate(g.expiresAt, true)}${g.authorisation === "EMERGENCY" ? " (opened in an emergency by Evantix)" : ""}` : `${g.requestedBy} asks for ${g.durationHours} hours of access`}</p>
            <p className="text-[13px] text-slate-700">Purpose: {g.purpose}</p>
            <p className="text-[13px] text-slate-700">Can see: {g.scopes.map((s) => SUPPORT_SCOPES[s as SupportScope] ?? s).join("; ")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {g.status === "REQUESTED" ? (
                <>
                  <form action={decideSupportAction}><input type="hidden" name="back" value="/settings#support-access" /><input type="hidden" name="grantId" value={g.id} /><input type="hidden" name="decision" value="approve" /><button className="btn-primary">Approve</button></form>
                  <form action={decideSupportAction}><input type="hidden" name="back" value="/settings#support-access" /><input type="hidden" name="grantId" value={g.id} /><input type="hidden" name="decision" value="decline" /><button className="btn-secondary">Decline</button></form>
                </>
              ) : (
                <form action={revokeSupportAction} className="flex flex-wrap items-end gap-2"><input type="hidden" name="back" value="/settings#support-access" /><input type="hidden" name="grantId" value={g.id} /><label><span className="label">Reason</span><input name="reason" required minLength={5} className="input" /></label><button className="btn-danger">Revoke access now</button></form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
