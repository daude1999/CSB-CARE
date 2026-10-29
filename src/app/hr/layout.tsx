import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HR & Workforce",
  robots: { index: false, follow: false },
  icons: { icon: "/brand/csb-monogram.png", shortcut: "/brand/csb-monogram.png" },
};

/**
 * HR & Workforce is the CSB HR Hub, unchanged. It brings its own style sheet (built by scripts/build-hr-css.mjs)
 * instead of the platform's, and the portal button opens it with a full page load so the two never mix.
 */
export default function HrLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-css-tags -- the HR Hub style sheet is built with Tailwind 4, outside this app's Tailwind 3 pipeline */}
      <link rel="stylesheet" href="/hr/hr-hub.css" precedence="default" />
      {/* eslint-disable-next-line @next/next/no-css-tags -- module colour on the HR Hub top bar, after the HR Hub sheet */}
      <link rel="stylesheet" href="/hr/hr-module-colour.css" precedence="default" />
      {/* eslint-disable-next-line @next/next/no-css-tags -- the platform's motion timings, in the HR Hub's own classes, after the HR Hub sheet */}
      <link rel="stylesheet" href="/hr/hr-motion.css" precedence="default" />
      {children}
    </>
  );
}
