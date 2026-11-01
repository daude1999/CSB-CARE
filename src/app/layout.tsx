import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/inter/wght.css";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/themes";


export const metadata: Metadata = {
  title: { default: "CSB All in One Platform", template: "%s | CSB" },
  description: "Policy and procedure management with regulatory change monitoring for adult social care.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-GB" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
