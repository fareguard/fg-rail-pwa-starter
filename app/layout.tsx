// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FareGuard — Automatic UK Train Delay Refunds",
  description:
    "Connect Gmail, we find rail e-tickets, detect delays and auto-file Delay Repay. Set up once, get back money you’d otherwise miss.",
  metadataBase: new URL("https://fareguard.co.uk"),
  openGraph: {
    title: "FareGuard — Automatic UK Train Delay Refunds",
    description:
      "Connect Gmail, detect delays automatically, and get paid without the faff.",
    url: "https://fareguard.co.uk",
    siteName: "FareGuard",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FareGuard — Automatic UK Train Delay Refunds",
    description:
      "Connect Gmail, detect delays automatically, and get paid without the faff.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
