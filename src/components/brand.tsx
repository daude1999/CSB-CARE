/* eslint-disable @next/next/no-img-element */
/** The CSB logo, redrawn as a vector from the original artwork so it stays sharp at any size. */
export function Logo({ className = "h-12 w-auto" }: { className?: string }) {
  return <img src="/csb-logo.svg" alt="CSB Care Solution Bureau" className={className} width={1224} height={324} />;
}
