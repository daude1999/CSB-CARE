/** CSB (Care Solution Bureau) logo mark and wordmark. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      <rect width="48" height="48" rx="10" fill="#c9a227" />
      <path d="M24 9 37 14v9c0 8.4-5.4 14.6-13 17-7.6-2.4-13-8.6-13-17v-9z" fill="#0b1f3f" />
      <path d="M24 31.5c-4.6-3-7.4-5.6-7.4-8.7 0-2.2 1.7-3.8 3.8-3.8 1.5 0 2.8.8 3.6 2 .8-1.2 2.1-2 3.6-2 2.1 0 3.8 1.6 3.8 3.8 0 3.1-2.8 5.7-7.4 8.7z" fill="#e8c95a" />
    </svg>
  );
}

export function Wordmark({ dark = true, size = "md" }: { dark?: boolean; size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <div className="flex items-center gap-3">
      <LogoMark size={big ? 52 : 36} />
      <div className="leading-tight">
        <div className={`${big ? "text-3xl" : "text-xl"} font-bold tracking-wide ${dark ? "text-white" : "text-navy-900"}`}>CSB</div>
        <div className={`${big ? "text-xs" : "text-[10px]"} font-medium uppercase tracking-[0.18em] ${dark ? "text-gold-400" : "text-gold-600"}`}>Care Solution Bureau</div>
      </div>
    </div>
  );
}
