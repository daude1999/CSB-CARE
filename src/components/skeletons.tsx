/**
 * Placeholders shown while the next page loads (src/components/main-area.tsx). Each has the shape of the page it
 * stands in for (title bar in the module colour, the Policy Library's hero and card, the Overview's tiles), so
 * nothing jumps when the real page arrives. They are drawn in the browser during client navigation only, so a
 * page loaded without JavaScript is never stuck behind one.
 */
function Bar({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton block ${className}`} />;
}

function Busy({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="skeleton-page" aria-busy="true" data-testid="page-skeleton">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** The usual inner page: title bar, explanation strip, then a panel of rows. */
export function PageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Busy label="Loading page">
      <div aria-hidden="true" className="h-[60px] rounded-t-[6px] bg-[var(--module,#0f2a4f)]" />
      <div className="skeleton-pulse">
        <div className="mb-3 flex items-center justify-between gap-6 rounded-b-[3px] bg-white px-[15px] py-3">
          <Bar className="h-[14px] w-[min(520px,60%)]" />
          <Bar className="hidden h-[30px] w-[120px] sm:block" />
        </div>
        <div className="panel">
          <Bar className="mb-4 h-[16px] w-[180px]" />
          <div className="space-y-[3px]">
            {Array.from({ length: rows }, (_, n) => (
              <div key={n} className="flex h-[42px] items-center gap-4 rounded-[2px] bg-[#f5f9fc] px-3">
                <Bar className="h-[12px] w-[28%]" />
                <Bar className="hidden h-[12px] w-[18%] sm:block" />
                <Bar className="ml-auto h-[12px] w-[12%]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Busy>
  );
}

/** The Policy Library: hero, then the card with its tabs, filters and rows. */
export function LibrarySkeleton() {
  return (
    <Busy label="Loading the Policy Library">
      <div className="pl-root">
        <div className="pl-hero skeleton-pulse">
          <Bar className="h-[13px] w-[200px]" />
          <Bar className="mt-[12px] h-[40px] w-[280px]" />
          <Bar className="mt-[12px] h-[14px] w-[min(620px,80%)]" />
        </div>
        <div className="pl-card">
          <div className="flex h-[48px] items-center gap-6 border-b border-[#ebe8e2] px-[24px]">
            {[90, 110, 80, 100].map((w) => (
              <span key={w} style={{ width: w }}>
                <Bar className="h-[12px]" />
              </span>
            ))}
          </div>
          <div className="skeleton-pulse space-y-3 p-[14px]">
            <Bar className="h-[32px] w-full" />
            {Array.from({ length: 6 }, (_, n) => (
              <div key={n} className="flex gap-[14px] px-[18px] py-[16px]">
                <Bar className="h-[36px] w-[36px] shrink-0" />
                <div className="flex-1 space-y-2">
                  <Bar className="h-[15px] w-[45%]" />
                  <Bar className="h-[12px] w-[70%]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Busy>
  );
}

/** The Overview: greeting, then one tile per module. */
export function OverviewSkeleton() {
  return (
    <Busy label="Loading the overview">
      <div className="ov-root">
        <div className="px-4 pb-4 pt-5 md:px-[33px]">
          <Bar className="h-[13px] w-[70px]" />
          <Bar className="mt-2 h-[40px] w-[min(380px,80%)]" />
          <Bar className="mt-3 h-[14px] w-[min(640px,90%)]" />
        </div>
        <div className="skeleton-pulse grid gap-3.5 px-4 pb-6 sm:grid-cols-2 md:px-[33px] xl:grid-cols-4">
          {Array.from({ length: 6 }, (_, n) => (
            <div key={n} className="ov-tile">
              <div className="h-[48px] bg-[#e9ebef]" />
              <div className="space-y-2.5 p-[14px]">
                <Bar className="h-[12px] w-[80%]" />
                <Bar className="h-[12px] w-[65%]" />
                <Bar className="h-[12px] w-[72%]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Busy>
  );
}

/** The placeholder for whichever page is on its way. */
export function SkeletonFor({ path, canvas }: { path: string; canvas: boolean }) {
  if (path === "/policies") return <LibrarySkeleton />;
  if (path === "/overview") return <OverviewSkeleton />;
  return canvas ? (
    <div className="page-canvas">
      <PageSkeleton />
    </div>
  ) : (
    <PageSkeleton />
  );
}
