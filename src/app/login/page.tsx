import { Logo } from "@/components/brand";
import { loginAction } from "../actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <main className="grid min-h-screen bg-paper lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-navy-950 px-12 py-12 text-white lg:flex">
        <div className="inline-flex self-start rounded-md bg-white px-4 py-3"><Logo className="h-12" /></div>
        <div className="max-w-lg">
          <p className="font-label text-[11px] uppercase tracking-[0.16em] text-teal-400">Policy governance for adult social care</p>
          <p className="mt-5 font-serif text-[2.6rem] font-medium leading-[1.12] tracking-[-0.015em]">Every policy current. Every change traced to its source. Every reader on record.</p>
          <p className="mt-6 max-w-md text-sm leading-6 text-slate-400">CSB watches the legislation and guidance your policies rely on, proposes revisions for your people to approve, and records who has read what.</p>
        </div>
        <p className="font-label text-[11px] uppercase tracking-[0.12em] text-slate-500">Care Solution Bureau</p>
        <div aria-hidden="true" className="absolute inset-y-0 right-0 w-[3px] bg-teal-400" />
      </section>
      <div className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 lg:hidden"><div className="inline-flex rounded-md bg-white px-4 py-3 ring-1 ring-slate-200"><Logo className="h-12" /></div></div>
        <h1 className="text-[2rem]">Sign in</h1>
        <p className="mb-8 mt-2 text-sm text-slate-600">Use the email address your organisation registered with CSB.</p>
        <form action={loginAction} className="space-y-5">
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
            <p className="border-t border-slate-300 pt-4 text-xs leading-5 text-slate-500">
              Demo environment: sign in as <code>manager@brookfield.demo</code>, <code>author@brookfield.demo</code>, <code>approver@brookfield.demo</code>, <code>carer1@brookfield.demo</code>, <code>regulatory@csb.demo</code> or <code>admin@csb.demo</code> with the password <code>DemoPassword!2026</code>.
            </p>
          ) : null}
        </form>
      </div>
      </div>
    </main>
  );
}
