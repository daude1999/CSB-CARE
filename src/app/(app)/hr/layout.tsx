import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HR & Workforce",
  robots: { index: false, follow: false },
};

/**
 * HR & Workforce is the CSB HR Hub, inside the platform's sidebar and top bar. Its screens keep their own style sheet
 * (built with Tailwind 4 by scripts/build-hr-css.mjs), confined to the HR Hub's root element so it never touches the
 * platform around it. Links into and out of these pages load a fresh page, so the sheet only exists here.
 */
export default function HrLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-css-tags -- the HR Hub style sheet is built with Tailwind 4, outside this app's Tailwind 3 pipeline */}
      <link rel="stylesheet" href="/hr/hr-hub.css" precedence="hr-hub" />
      {children}
    </>
  );
}
