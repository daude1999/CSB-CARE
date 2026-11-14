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

/** The usual inner page: the module header band, then a panel of rows. */
export function PageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Busy label="Loading page">
      <div aria-hidden="true" className="mb-header-gap flex h-[96px] items-center gap-4 rounded-header bg-module px-header-x">
        <span className="h-chip w-chip shrink-0 rounded-chip bg-white/16" />
        <span className="h-[14px] w-[min(320px,50%)] rounded-full bg-white/16" />
      </div>
      <div className="skeleton-pulse">
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

/** The Overview: greeting, the Rota tile beside Needs your attention, then four module tiles. */
export function OverviewSkeleton() {
  return (
    <Busy label="Loading the overview">
      <div className="ov-root">
        <div className="skeleton-pulse px-4 pb-6 pt-5">
          <div className="w-full space-y-[16px]">
            <div>
              <Bar className="h-[30px] w-[min(320px,70%)]" />
              <Bar className="mt-2 h-[16px] w-[min(460px,90%)]" />
            </div>
            <div className="grid grid-cols-1 gap-[16px] min-[1100px]:grid-cols-[minmax(0,60fr)_minmax(0,40fr)]">
              <div className="h-[372px] rounded-[18px] bg-[#e9ebef]" />
              <div className="h-[372px] rounded-[18px] border border-[#eaecf0] bg-white" />
            </div>
            <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2 min-[1100px]:grid-cols-4">
              {Array.from({ length: 4 }, (_, n) => <div key={n} className="h-[224px] rounded-[18px] bg-[#e9ebef]" />)}
            </div>
          </div>
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
