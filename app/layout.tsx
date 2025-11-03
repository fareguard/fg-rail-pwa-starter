// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";

export const metadata: Metadata = {
  title: "FareGuard — Automatic Delay Repay",
  description:
    "Plug in once. We find rail e-tickets in Gmail, detect delays, and auto-file Delay Repay for you.",
};

// Use the correct prop name: `weight`
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={jakarta.className}>{children}</body>
    </html>
  );
}
