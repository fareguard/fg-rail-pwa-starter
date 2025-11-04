// app/(app)/dashboard/page.tsx
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default function DashboardMinimalServer() {
  return (
    <div style={{ padding: 24 }}>
      <h1>Dashboard — minimal server page</h1>
      <p>If you can see this, the route renders server-side correctly.</p>
      <p>Next: we’ll switch back to the client version.</p>
    </div>
  );
}
