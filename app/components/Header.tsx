export default function Header() {
  return (
    <header className="w-full border-b border-brand-border bg-white">
      <div className="max-w-5xl mx-auto flex items-center justify-between p-4">
        <h1 className="text-xl font-bold text-brand-text">FareGuard</h1>
        <nav className="flex gap-4 text-sm text-brand-muted">
          <a href="/results">Tickets</a>
          <a href="/onboarding">Onboarding</a>
          <a href="/dashboard">Dashboard</a>
        </nav>
      </div>
    </header>
  );
}
