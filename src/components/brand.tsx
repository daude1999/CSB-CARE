/* eslint-disable @next/next/no-img-element */
/** The CSB (Care Solution Bureau) logo. The artwork has a light background, so it always sits on white. */
export function Logo({ className = "h-12" }: { className?: string }) {
  return <img src="/csb-logo.png" alt="CSB Care Solution Bureau" className={`w-auto ${className}`} width={628} height={178} />;
}
