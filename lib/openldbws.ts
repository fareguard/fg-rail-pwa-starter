// lib/openldbws.ts
const ENDPOINT = "https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb9.asmx";

function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function getDepartureBoard(crs: string, numRows = 10) {
  const token = process.env.OPENLDBWS_TOKEN;
  if (!token) throw new Error("Missing OPENLDBWS_TOKEN");

  const CRS = xmlEscape(crs.toUpperCase());

  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
                 xmlns:ldb="http://thalesgroup.com/RTTI/2017-10-01/ldb/">
  <soap12:Header>
    <ldb:AccessToken>
      <ldb:TokenValue>${xmlEscape(token)}</ldb:TokenValue>
    </ldb:AccessToken>
  </soap12:Header>
  <soap12:Body>
    <ldb:GetDepartureBoardRequest>
      <ldb:numRows>${numRows}</ldb:numRows>
      <ldb:crs>${CRS}</ldb:crs>
    </ldb:GetDepartureBoardRequest>
  </soap12:Body>
</soap12:Envelope>`;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/soap+xml; charset=utf-8",
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenLDBWS HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  return text; // (next step: parse to JSON)
}
