import Link from "@/components/link";
import { ModuleHeader } from "@/components/module-header-band";

export default function NotFound() {
  return (
    <>
      <ModuleHeader title="Not found" />
      <div className="card max-w-xl">
        <p className="text-sm text-slate-600">This record does not exist or you do not have access to it.</p>
        <Link className="btn-secondary mt-4" href="/overview">Back to overview</Link>
      </div>
    </>
  );
}
