import { Logo } from "@/components/brand";
import { describeToken } from "@/server/admin/users";
import { redeemTokenAction } from "@/app/admin-actions";

export const dynamic = "force-dynamic";

/** Public page for a one-time invitation or password reset link. The token is checked on the server on every use. */
export default async function AccountLinkPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const t = /^[A-Za-z0-9_-]{20,100}$/.test(token) ? await describeToken(token) : null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 inline-flex rounded-md bg-white px-4 py-3 ring-1 ring-slate-200"><Logo className="h-12" /></div>
        {t ? (
          <>
            <h1 className="text-[1.75rem]">{t.kind === "RESET" ? "Choose a new password" : `Join ${t.organisation}`}</h1>
            <p className="mb-6 mt-2 text-sm text-slate-600">{t.kind === "RESET" ? `For ${t.email}. Signing in elsewhere will end when you save.` : t.needsName ? `Set up your account for ${t.email}.` : `${t.email} already has an account. Choose a password to confirm; your existing password is kept and you are added to ${t.organisation}.`}</p>
            <form action={redeemTokenAction} className="space-y-4">
              {sp.error ? <div role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{sp.error}</div> : null}
              <input type="hidden" name="token" value={token} />
              {t.needsName ? <div><label className="label" htmlFor="name">Your name</label><input className="input" id="name" name="name" defaultValue={t.name ?? ""} required minLength={2} autoComplete="name" /></div> : null}
              <div><label className="label" htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" required minLength={12} autoComplete="new-password" /></div>
              <div><label className="label" htmlFor="confirm">Type it again</label><input className="input" id="confirm" name="confirm" type="password" required minLength={12} autoComplete="new-password" /></div>
              <p className="text-[12.5px] text-slate-600">At least 12 characters. A short sentence you will remember works well.</p>
              <button className="btn-primary w-full">{t.kind === "RESET" ? "Save password" : "Create my account"}</button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-[1.75rem]">This link has expired</h1>
            <p className="mt-2 text-sm text-slate-600">It may have been used already, revoked or be more than a few days old. Ask your administrator for a new one.</p>
            <a href="/login" className="btn-secondary mt-6 inline-block">Go to sign in</a>
          </>
        )}
      </div>
    </main>
  );
}
