import type { Metadata } from "next";
import { Geist, Geist_Mono, Marcellus, Mea_Culpa } from "next/font/google";
import "./globals.css";
import { SHOP_NAME } from "@/lib/brand";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// La Patisserie Madras brand (2026-10-28): the logo's signature script for the shop name, a flared
// serif for "MADRAS", small capitals and headings. Body text stays Geist.
const marcellus = Marcellus({
  variable: "--font-marcellus",
  weight: "400",
  subsets: ["latin"],
});

const meaCulpa = Mea_Culpa({
  variable: "--font-mea-culpa",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: `${SHOP_NAME} — Staff`, template: `%s · ${SHOP_NAME}` },
  description: `${SHOP_NAME} order management`,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-IN"
      className={`${geistSans.variable} ${geistMono.variable} ${marcellus.variable} ${meaCulpa.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
