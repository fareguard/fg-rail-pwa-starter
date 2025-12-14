// lib/openldbws.ts
const ENDPOINT = "https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb9.asmx";

function mustGetToken() {
  const t = process.env.OPENLDBWS_TOKEN || "";
  if (!t) throw new Error("Missing OPENLDBWS_TOKEN");
  return t.trim();
}

export async function openLdbwsCall(bodyInnerXml: string) {
  const token = mustGetToken();

  // IMPORTANT: token should be lowercase hex (OpenLDBWS is picky)
  const tokenLower = token.toLowerCase();

  // SOAP 1.2 envelope (works with the sample queries on Open Rail Data Wiki)
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:typ="http://thalesgroup.com/RTTI/2013-11-28/Token/types">
  <soap:Header>
    <typ:AccessToken>
      <typ:TokenValue>${tokenLower}</typ:TokenValue>
    </typ:AccessToken>
  </soap:Header>
  <soap:Body>
    ${bodyInnerXml}
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      // SOAP 1.2 (no SOAPAction header needed)
      "Content-Type": "application/soap+xml; charset=utf-8",
      "Accept": "application/soap+xml, text/xml;q=0.9, */*;q=0.8",
      "User-Agent": "FareGuard/1.0",
      // Avoid compression issues
      "Accept-Encoding": "identity",
    },
    body: envelope,
    cache: "no-store",
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`OpenLDBWS HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  return text;
}
