import "./globals.css";

export const metadata = {
  title: "FareGuard — Cheaper UK train tickets. Automatic refunds.",
  description:
    "We search fares, track your journey, and auto-file Delay Repay. £1.50 per booking. No win, no fee (20% of refunds).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
