/**
 * Proxy to the PVGIS 5.3 PVcalc API (EU JRC, free, no key). Returns the annual and monthly
 * AC energy PVGIS computes with its own model for one orientation and peak power.
 * Azimuth comes in the pvlib convention (180 = south) and is converted to PVGIS "aspect"
 * (0 = south, -90 = east, 90 = west). The result is a reference estimate, not GESPlan's engine.
 * PVGIS output is linear in peak power, so it is always asked for 1 kWp and the result is
 * scaled by kwp here; the cache then holds one entry per location and orientation.
 */
import { boundedCache, concurrencyLimit } from "../../../lib/server/upstream";

interface PerKwp {
  annual: number;
  monthly: number[];
  radiationDb: string | null;
}

const cache = boundedCache<PerKwp>();
// PVGIS allows far more, but two at a time is plenty for one designer and caps abuse
const upstream = concurrencyLimit(2);
const SYSTEM_LOSS_PCT = 14;
const MAX_KWP = 1_000_000;

function num(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** PVGIS error bodies are JSON with a "message" field; anything else yields null. */
function errorMessage(text: string): string | null {
  try {
    const msg = JSON.parse(text)?.message;
    return typeof msg === "string" && msg.trim() !== "" ? msg.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}

function parseResult(text: string): PerKwp | null {
  try {
    const data = JSON.parse(text);
    const annual = data?.outputs?.totals?.fixed?.E_y;
    const monthly = data?.outputs?.monthly?.fixed;
    if (!Number.isFinite(annual) || !Array.isArray(monthly)) return null;
    const perMonth = monthly.map((m: { E_m?: unknown }) => m?.E_m);
    if (!perMonth.every(Number.isFinite)) return null;
    const db = data?.inputs?.meteo_data?.radiation_db;
    return { annual, monthly: perMonth as number[], radiationDb: typeof db === "string" ? db : null };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const lat = num(q.get("lat"));
  const lon = num(q.get("lon"));
  const kwp = num(q.get("kwp"));
  const tilt = num(q.get("tilt"));
  const azimuth = num(q.get("azimuth"));
  const mounting = q.get("mounting") === "building" ? "building" : "free";
  if (lat === null || lon === null || kwp === null || tilt === null || azimuth === null) {
    return Response.json({ error: "lat, lon, kwp, tilt ve azimuth gerekli" }, { status: 400 });
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || tilt < 0 || tilt > 90) {
    return Response.json({ error: "Değerler geçerli aralıkta değil" }, { status: 400 });
  }
  if (kwp <= 0 || kwp > MAX_KWP) {
    return Response.json({ error: "Kurulu güç 0 ile 1.000.000 kWp arasında olmalı" }, { status: 400 });
  }
  const aspect = ((((azimuth - 180) % 360) + 540) % 360) - 180;
  const respond = (r: PerKwp) => {
    const scale = (v: number) => Math.round(v * kwp * 100) / 100;
    return Response.json({
      annualKwh: scale(r.annual),
      monthlyKwh: r.monthly.map(scale),
      specificKwhPerKwp: r.annual,
      radiationDb: r.radiationDb,
      systemLossPct: SYSTEM_LOSS_PCT,
      aspect,
      mounting,
    });
  };
  const key = [lat.toFixed(4), lon.toFixed(4), tilt.toFixed(1), aspect.toFixed(1), mounting].join("|");
  const cached = cache.get(key);
  if (cached) return respond(cached);

  const url = new URL("https://re.jrc.ec.europa.eu/api/v5_3/PVcalc");
  url.search = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    peakpower: "1",
    loss: String(SYSTEM_LOSS_PCT),
    angle: String(tilt),
    aspect: String(aspect),
    mountingplace: mounting,
    outputformat: "json",
  }).toString();

  let res: { ok: boolean; status: number; text: string };
  try {
    res = await upstream(async () => {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      return { ok: r.ok, status: r.status, text: await r.text() };
    });
  } catch (e) {
    return Response.json({ error: "PVGIS'e ulaşılamadı", detail: String(e) }, { status: 502 });
  }
  if (!res.ok) {
    const msg = errorMessage(res.text);
    // PVGIS answers 400 with a reason for inputs it rejects, such as a point over the sea
    const error =
      res.status === 400 && msg
        ? `PVGIS bu konum için hesap yapamadı: ${msg}`
        : `PVGIS hata verdi (${res.status})${msg ? `: ${msg}` : ""}`;
    return Response.json({ error, detail: res.text.slice(0, 300) }, { status: 502 });
  }
  const result = parseResult(res.text);
  if (!result) {
    return Response.json({ error: "PVGIS beklenmeyen bir yanıt verdi", detail: res.text.slice(0, 300) }, { status: 502 });
  }
  cache.set(key, result);
  return respond(result);
}
