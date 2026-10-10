import type { Metadata, Viewport } from "next";
import { Mona_Sans, Newsreader } from "next/font/google";
import { site } from "@/content/site";
import "./globals.css";

// Mona Sans carries the display type and the small labels; its width axis is what the
// name ripples and the big words inflate on. Newsreader, with optical sizing, sets the
// sentences people actually read.
const display = Mona_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});
const text = Newsreader({
  variable: "--font-text",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

const fullName = `${site.name.first} ${site.name.last}`;

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: `${fullName} — ${site.role}`,
  description: `${fullName} builds websites, funnels, CRM and GoHighLevel systems, AI follow-up and paid ad campaigns as one connected system.`,
  openGraph: {
    title: fullName,
    description: site.role,
    type: "website",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: `${fullName}: a red ball at the top of a brass rail` }],
  },
  twitter: { card: "summary_large_image", images: ["/og.jpg"] },
};

export const viewport: Viewport = {
  themeColor: "#dbd3c7",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable} antialiased`}>
      <body>
        {/* Without JavaScript nothing un-hides the film's first frame, so show it outright. */}
        <noscript>
          <style>{".film-gate{opacity:1}"}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
