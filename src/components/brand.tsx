/* eslint-disable @next/next/no-img-element */
/** Crisp vector CSB wordmark for the shared application shell. */
export function Logo({ className = "h-12" }: { className?: string }) {
  return <img src="/csb-logo.svg" alt="CSB Care Solution Bureau" className={`w-auto ${className}`} width={640} height={150} />;
}
