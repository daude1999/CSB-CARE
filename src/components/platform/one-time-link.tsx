import { cookies } from "next/headers";
import { PLATFORM_LINK_COOKIE } from "@/app/platform-link";
import { CopyButton } from "@/components/copy-button";
import { ForgetLink } from "./forget-link";

/** A just-created invitation or reset link, shown once: the cookie is cleared as soon as it is on screen. It is emailed too only when the confirmation message says so. */
export async function OneTimeLink() {
  const link = (await cookies()).get(PLATFORM_LINK_COOKIE)?.value ?? null;
  if (!link) return null;
  return (
    <section aria-label="One-time link" className="mb-4 rounded-[8px] border border-px-accent/30 bg-px-accent-tint p-4">
      <ForgetLink />
      <p className="text-body font-medium text-px-accent-strong">Give this link to the person through an approved, private route. It works once, and it is shown only this once: copy it now.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 break-all rounded-[4px] bg-white px-2 py-1 font-mono text-meta" data-testid="one-time-link">{link}</p>
        <CopyButton value={link} label="Copy link" />
      </div>
      <p className="mt-1 text-meta text-px-muted">Evantix never sees or sets the person&apos;s password. Anyone holding the link can use it, so do not post it in a shared channel.</p>
    </section>
  );
}
