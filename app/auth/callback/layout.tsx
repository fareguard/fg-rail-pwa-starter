// app/auth/callback/layout.tsx
export const dynamic = 'force-dynamic';
export const revalidate = false;          // must be boolean false or a number
export const fetchCache = 'force-no-store';
export const dynamicParams = true;

export default function CallbackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
