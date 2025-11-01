// app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "FareGuard — Cheap tickets + automatic refunds",
  description:
    "Cheapest UK train tickets with automatic refunds. £1.50 service fee per booking. No win, no fee (20% of refunds).",
  themeColor: "#0F2A43",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
