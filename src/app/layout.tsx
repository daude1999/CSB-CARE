import type { Metadata } from "next";
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
