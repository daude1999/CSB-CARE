/** Admin Centre button styles, shared by server pages and client components. */
export const btn = "btn inline-flex items-center justify-center gap-1.5 whitespace-nowrap border transition-colors";
export const pxPrimary = `${btn} border-px-accent bg-px-accent text-white hover:border-px-accent-hover hover:bg-px-accent-hover hover:text-white`;
export const pxSecondary = `${btn} border-px-line bg-white text-px-body shadow-[0_1px_0_rgba(15,27,61,0.04)] hover:border-[#c9cdd9] hover:bg-px-field hover:text-px-ink`;
export const pxDanger = `${btn} border-px-danger-strong bg-px-danger-strong text-white hover:border-[#8f1b2a] hover:bg-[#8f1b2a] hover:text-white`;
export const pxGhost = `${btn} border-transparent bg-transparent text-px-body hover:bg-px-row hover:text-px-ink`;
/** Compact size modifier for buttons inside tables and toolbars. */
export const pxSm = "!h-8 !px-2.5 !text-meta";
export const pxLink = "font-medium text-px-accent no-underline hover:text-px-accent-hover hover:underline";
