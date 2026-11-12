/** Shown while the rostering search runs. */
export default function SearchLoading() {
  return (
    <section className="panel" aria-busy="true">
      <p role="status" className="text-body text-slate-600">Searching…</p>
    </section>
  );
}
