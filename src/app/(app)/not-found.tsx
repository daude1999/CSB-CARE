import Link from "@/components/link";

export default function NotFound() {
  return (
    <div className="card max-w-xl">
      <h1>Not found</h1>
      <p className="mt-2 text-sm text-slate-600">This record does not exist or you do not have access to it.</p>
      <Link className="btn-secondary mt-4" href="/overview">Back to overview</Link>
    </div>
  );
}
