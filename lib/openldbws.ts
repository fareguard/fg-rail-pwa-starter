// lib/openldbws.ts
export async function openLdbwsCall(
  soapAction: string,
  soapBodyXml: string
): Promise<string> {
  const token = process.env.OPENLDBWS_TOKEN;
  if (!token) throw new Error("Missing OPENLDBWS_TOKEN");

  // Pick a pinned endpoint (matches WSDL versions like ldb11, ldb12 etc)
  // If your WSDL is ldb11.wsdl, use ldb11.asmx. If it's ldb12.wsdl, use ldb12.asmx.
  const endpoint = "https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb11.asmx";

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:typ="http://thalesgroup.com/RTTI/2013-11-28/Token/types"
  xmlns:ldb="http://thalesgroup.com/RTTI/2017-10-01/ldb/">
  <soap:Header>
    <typ:AccessToken>
      <typ:TokenValue>${token}</typ:TokenValue>
    </typ:AccessToken>
  </soap:Header>
  <soap:Body>
    ${soapBodyXml}
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: soapAction,
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
