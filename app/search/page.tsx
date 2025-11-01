// app/search/page.tsx
export default function SearchPage(){
  return (
    <main className="container" style={{padding:"32px 0"}}>
      <h1 style={{color:"var(--fg-navy)"}}>Search tickets</h1>
      <p className="sub">Ticket search UI coming here. For now, this links works.</p>
      <a className="btn btnPrimary" href="/api/eligibility/run">Seed demo claims</a>
    </main>
  )
}
