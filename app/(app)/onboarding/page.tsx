// app/onboarding/page.tsx
export default function Onboarding(){
  return (
    <main className="container" style={{padding:"32px 0"}}>
      <h1 style={{color:"var(--fg-navy)"}}>Get started</h1>
      <p className="sub">Connect your email or forward tickets to <b>tickets@fareguard.co.uk</b>. We’ll do the rest.</p>
      <ul className="list" style={{marginTop:12}}>
        <li><span className="dot" /> Option A: Sign in and connect Gmail (coming soon).</li>
        <li><span className="dot" /> Option B: Forward tickets to the address above.</li>
      </ul>
    </main>
  );
}
