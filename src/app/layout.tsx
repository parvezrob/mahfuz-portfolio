import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { site } from "@/content/site";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
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
  },
};

export const viewport: Viewport = {
  themeColor: "#dbd3c7",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
