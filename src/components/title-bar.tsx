import Link from "@/components/link";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";

/** The navy page title bar shared by the dashboard, My Policies and the QCS-style inner pages. */
export function TitleBar({ title, back, children }: { title: React.ReactNode; back?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-t-[6px] bg-navy-900 px-4 text-white">
      <div className="relative flex min-h-[60px] items-center justify-center py-3">
        {back ? <Link href={back} className="absolute left-0 flex items-center gap-2 text-[15px] text-white no-underline hover:text-teal-200"><CaretLeft size={14} weight="bold" aria-hidden="true" />Back</Link> : null}
        <h1 className="px-16 text-center text-[20px] font-medium leading-snug tracking-normal text-white">{title}</h1>
      </div>
      {children ? <div className="pb-5">{children}</div> : null}
    </div>
  );
}
