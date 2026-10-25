/* eslint-disable @next/next/no-img-element */
/** Crisp vector CSB wordmark for the shared application shell; `light` is the version for dark backgrounds. */
export function Logo({ className = "h-12", light = false }: { className?: string; light?: boolean }) {
  return <img src={light ? "/csb-logo-light.svg" : "/csb-logo.svg"} alt="CSB Care Solution Bureau" className={`w-auto ${className}`} width={640} height={150} />;
}
