/**
 * Address search through OpenStreetMap Nominatim, limited to Türkiye. Nominatim's usage
 * policy asks for an identifying User-Agent and at most one request per second, so the UI
 * only searches on submit, results are cached in memory and upstream calls are spaced.
 */
import { boundedCache, spacedTurns } from "../../../lib/server/upstream";

interface GeocodeBody {
  results: { name: string; lat: number; lon: number; bbox: number[] | null }[];
}

const cache = boundedCache<GeocodeBody>();
// a little over one second so clock jitter never breaks the policy
const nominatimTurn = spacedTurns(1100);

/** Nominatim errors come as {"error": {"message": ...}} or {"error": "..."}; else null. */
function errorMessage(text: string): string | null {
  try {
    const err = JSON.parse(text)?.error;
    const msg = typeof err === "string" ? err : err?.message;
    return typeof msg === "string" && msg.trim() !== "" ? msg.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}

function parseRows(text: string): GeocodeBody | null {
  try {
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) return null;
    return {
      results: rows
        .map((r) => ({
          name: String(r?.display_name ?? ""),
          lat: Number(r?.lat),
          lon: Number(r?.lon),
          bbox: Array.isArray(r?.boundingbox) ? r.boundingbox.map(Number) : null,
        }))
        .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)),
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ error: "Arama en az 2 karakter olmalı" }, { status: 400 });
  if (q.length > 200) return Response.json({ error: "Arama en fazla 200 karakter olabilir" }, { status: 400 });
  const key = q.toLocaleLowerCase("tr-TR");
  const cached = cache.get(key);
  if (cached) return Response.json(cached);

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ format: "jsonv2", limit: "5", countrycodes: "tr", "accept-language": "tr", q }).toString();
  let res: { ok: boolean; status: number; text: string };
  try {
    await nominatimTurn();
    const r = await fetch(url, {
      headers: { "User-Agent": "GESPlan-prototype/0.1 (local development)" },
      signal: AbortSignal.timeout(15000),
    });
    res = { ok: r.ok, status: r.status, text: await r.text() };
  } catch (e) {
    return Response.json({ error: "Adres servisine ulaşılamadı", detail: String(e) }, { status: 502 });
  }
  if (!res.ok) {
    const msg = errorMessage(res.text);
    return Response.json(
      { error: `Adres servisi hata verdi (${res.status})${msg ? `: ${msg}` : ""}`, detail: res.text.slice(0, 300) },
      { status: 502 },
    );
  }
  const body = parseRows(res.text);
  if (!body) {
    return Response.json({ error: "Adres servisi beklenmeyen bir yanıt verdi", detail: res.text.slice(0, 300) }, { status: 502 });
  }
  cache.set(key, body);
  return Response.json(body);
}
