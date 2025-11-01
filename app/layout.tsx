// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"], // <- singular 'weight'
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FareGuard — Cheaper UK train tickets. Automatic refunds.",
  description:
    "Connect Gmail and get Delay Repay handled automatically. All UK operators supported.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* expose the CSS variable so you can use it in globals.css */}
      <body className={jakarta.variable}>{children}</body>
    </html>
  );
}
