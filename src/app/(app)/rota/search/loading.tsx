/** Shown while the rostering search runs. */
export default function SearchLoading() {
  return (
    <section className="panel" aria-busy="true">
      <p role="status" className="text-[14px] text-slate-600">Searching…</p>
    </section>
  );
}
