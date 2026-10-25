import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource-variable/source-serif-4/opsz.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CSB | Care Solution Bureau", template: "%s | CSB" },
  description: "Policy and procedure management with regulatory change monitoring for adult social care.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
