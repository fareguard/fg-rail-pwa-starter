// app/(app)/layout.tsx
import React from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = false as const; // ✅ MUST be number or false, not an object
export const fetchCache = 'force-no-store';
export const dynamicParams = true;

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
