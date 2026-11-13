import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/inter/wght.css";
// Harbour type: Instrument Sans for the interface, Newsreader for long document text (self-hosted, never fetched at runtime).
import "@fontsource/instrument-sans/latin-400.css";
import "@fontsource/instrument-sans/latin-500.css";
import "@fontsource/instrument-sans/latin-600.css";
import "@fontsource/instrument-sans/latin-700.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import "@fontsource/newsreader/latin-400-italic.css";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/themes";
import { MODE_BOOT_SCRIPT, MODE_COOKIE, initialAppearance, parseMode } from "@/lib/colour-mode";


export const metadata: Metadata = {
  title: { default: "CSB All in One Platform", template: "%s | CSB" },
  description: "Policy and procedure management with regulatory change monitoring for adult social care.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const mode = parseMode(jar.get(MODE_COOKIE)?.value);
  // data-mode is what the page shows (light or dark); data-mode-pref is the person's choice, which may be "system".
  // The boot script may change data-mode before the first paint, so React is told not to mind the difference.
  return (
    <html lang="en-GB" data-theme={theme} data-mode={initialAppearance(mode)} data-mode-pref={mode} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MODE_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
