import Link from "next/link";

export default function Nav() {
  return (
    <div className="nav">
      <div className="container navInner">
        <Link href="/" className="brand">FareGuard</Link>
        <nav style={{ display: "flex", gap: 16 }}>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/dashboard">Dashboard</Link>
        </nav>
      </div>
    </div>
  );
}
