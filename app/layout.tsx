// app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';

export const metadata: Metadata = {
  title: 'FareGuard — Cheaper UK train tickets. Automatic refunds.',
  description:
    'We track your e-tickets and auto-file Delay Repay. Set up once, then it runs in the background.',
};

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weights: ['400', '500', '600', '700', '800'] as any, // keep bold weights available
  variable: '--font-jakarta',
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
