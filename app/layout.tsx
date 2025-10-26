import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "FareGuard — Cheapest tickets + automatic refunds",
  description: "Refunds filed automatically. No win, no fee (20%).",
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
