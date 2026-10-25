import { Logo } from "@/components/brand";
import { loginAction } from "../actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto inline-flex rounded-2xl bg-white px-6 py-4 shadow-lg ring-1 ring-black/5"><Logo className="h-16" /></div>
          <p className="mt-5 text-sm text-slate-300">Policies, procedures and regulatory change for adult social care, kept under review.</p>
        </div>
        <form action={loginAction} className="card space-y-4 border-t-4 border-t-teal-400">
          {sp.error ? (
            <div role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {sp.error}
            </div>
          ) : null}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button className="btn-primary w-full" type="submit">Sign in</button>
          {process.env.SHOW_DEMO_LOGINS === "true" || (process.env.NODE_ENV !== "production" && process.env.SHOW_DEMO_LOGINS !== "false") ? (
            <p className="text-xs text-slate-500">
              Demo environment: sign in as <code>manager@brookfield.demo</code>, <code>author@brookfield.demo</code>, <code>approver@brookfield.demo</code>, <code>carer1@brookfield.demo</code>, <code>regulatory@csb.demo</code> or <code>admin@csb.demo</code> with the password <code>DemoPassword!2026</code>.
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
