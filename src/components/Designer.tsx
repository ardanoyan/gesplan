"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONStoreFeatures } from "terra-draw";
import MapCanvas, { type DrawMode, type DrawnShape, type MapCanvasHandle } from "./MapCanvas";
import { NumberField, Section, Segmented, Stat, TextField } from "./fields";
import PanelSelection, { PANEL_SELECTION_TITLE_ID } from "./catalog/PanelSelection";
import type { DesignSnapshot } from "@/lib/catalog/compare";
import { useModules } from "@/lib/catalog/hooks";
import type { ModuleRecord, ModuleRef } from "@/lib/catalog/schema";
import { PLACEHOLDER_MODULE, isUsable, moduleLabel, moduleSpec, resolveModule } from "@/lib/catalog/select";
import { localFrame, meanLonLat } from "@/lib/geo/frame";
import { layoutFace, suggestAzimuth, type FaceSpec, type LayoutResult, type ObstacleSpec } from "@/lib/geo/layout";
import { edgeLengths } from "@/lib/geo/polygon";
import type { LonLat, XY } from "@/lib/geo/types";
import { compass, fmt } from "@/lib/format";

interface RoofMeta extends FaceSpec {
  name: string;
}
interface ObstacleMeta {
  name: string;
  heightM: number;
  clearanceM: number;
}
/**
 * v2 stores which catalogue module the design packs with (id and record version) instead of
 * hand-typed module values. A null `moduleRef` means "the catalogue default", resolved on load.
 */
interface Saved {
  version: 2;
  features: GeoJSONStoreFeatures[];
  roofs: Record<string, RoofMeta>;
  obstacles: Record<string, ObstacleMeta>;
  moduleRef: ModuleRef | null;
  gapM: number;
}
/** Before the catalogue: the module was edited by hand in the panel. */
interface SavedV1 {
  version: 1;
  features: GeoJSONStoreFeatures[];
  roofs: Record<string, RoofMeta>;
  obstacles: Record<string, ObstacleMeta>;
  module?: { name?: string; wp?: number; lengthM?: number; widthM?: number; gapM?: number };
}
interface RoofLayout {
  id: string;
  meta: RoofMeta;
  ring: LonLat[];
  footprint: XY[];
  res: LayoutResult;
}
interface EstimateRow {
  id: string;
  name: string;
  kind: RoofMeta["kind"];
  kwp: number;
  annualKwh: number;
}
interface EstimateFailure {
  id: string;
  name: string;
  error: string;
}
interface Estimate {
  /** "error" only when every face failed; otherwise failed faces are listed next to the totals. */
  status: "idle" | "loading" | "done" | "error";
  rows: EstimateRow[];
  failed: EstimateFailure[];
  signature: string;
  radiationDb?: string | null;
}
interface SearchResult {
  name: string;
  lat: number;
  lon: number;
}

// The key predates the v2 format and is kept so designs saved before the catalogue are still
// found; the format version lives inside the stored value (see loadSaved).
const STORAGE_KEY = "gesplan-prototype-v1";
const DEFAULT_GAP_M = 0.02;
// Inlined at build time; resolveModule ignores it unless it names a usable record.
const ENV_DEFAULT_MODULE_ID = process.env.NEXT_PUBLIC_DEFAULT_MODULE_ID;

function validGap(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

// The HTTP source's messages ("Katalog servisine ulaşılamadı") have no full stop, and a second
// sentence follows them in the Modül section.
function asSentence(text: string): string {
  const t = text.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

function isModuleRef(v: unknown): v is ModuleRef {
  return !!v && typeof v === "object" && "id" in v && "version" in v && typeof v.id === "string" && typeof v.version === "string";
}

function loadSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Saved | SavedV1 | null;
    if (data?.version === 2) {
      return { ...data, moduleRef: isModuleRef(data.moduleRef) ? data.moduleRef : null, gapM: validGap(data.gapM) ? data.gapM : DEFAULT_GAP_M };
    }
    if (data?.version === 1) {
      // v1 power and size were typed by hand, not taken from a datasheet, so they are dropped and
      // the design packs with the catalogue default. The gap is a mounting choice and carries over.
      const gapM = data.module?.gapM;
      return {
        version: 2,
        features: data.features,
        roofs: data.roofs,
        obstacles: data.obstacles,
        moduleRef: null,
        gapM: validGap(gapM) ? gapM : DEFAULT_GAP_M,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeSaved(data: Saved | null) {
  try {
    if (data) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage can be unavailable (private mode, quota); the prototype still works without it
  }
}

const UNEXPECTED_RESPONSE = "Sunucudan beklenmeyen bir yanıt geldi.";

/** GETs one of our JSON routes and turns every failure into a Turkish message the panel can show as is. */
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal }).catch(() => {
    throw new Error("Sunucuya ulaşılamadı; bağlantıyı kontrol edip tekrar deneyin.");
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Sunucu hata verdi (${res.status}).`);
  if (body === null || typeof body !== "object") throw new Error(UNEXPECTED_RESPONSE);
  return body as T;
}

function centroid(ring: LonLat[]): LonLat {
  return meanLonLat([ring]) ?? ring[0];
}

/** Highest N among names like "Çatı N", so new names never repeat one still in use (after deletes or a reload). */
function highestNumber(metas: Record<string, { name: string }>, pattern: RegExp): number {
  let max = 0;
  for (const m of Object.values(metas)) {
    const hit = pattern.exec(m.name);
    if (hit) max = Math.max(max, Number(hit[1]));
  }
  return max;
}

/** Rounds before wrapping, so 359.6 shows as 0° K and never as 360°. */
function shownAzimuth(deg: number, digits = 0): number {
  const f = 10 ** digits;
  return (((Math.round(deg * f) / f) % 360) + 360) % 360;
}

// layoutFace inputs are keyed without display names, so renaming never repacks a face.
const omitName = (key: string, value: unknown) => (key === "name" ? undefined : value);

function faceSpec(m: RoofMeta): FaceSpec {
  const { kind, tiltDeg, azimuthDeg, setbackM, orientation, rackTiltDeg, rowsPerTable, limitElevationDeg } = m;
  return { kind, tiltDeg, azimuthDeg, setbackM, orientation, rackTiltDeg, rowsPerTable, limitElevationDeg };
}

function defaultRoof(name: string, ring: LonLat[]): RoofMeta {
  const c = centroid(ring);
  const f = localFrame(c[0], c[1]);
  return {
    name,
    kind: "pitched",
    tiltDeg: 10,
    azimuthDeg: suggestAzimuth(ring.map(f.toLocal)),
    setbackM: 0.5,
    orientation: "portrait",
    rackTiltDeg: 10,
    rowsPerTable: 1,
    limitElevationDeg: 20,
  };
}

const HINTS: Record<DrawMode, string> = {
  roof: "Çatı köşelerine sırayla tıklayın. Bitirmek için ilk noktaya tıklayın ya da Enter'a basın; Esc iptal eder.",
  obstacle: "Engelin (baca, klima, çatı penceresi) köşelerine tıklayın. İlk noktaya tıklayınca ya da Enter ile biter.",
  select: "Şekle tıklayarak seçin, köşeleri sürükleyerek düzenleyin. Seçiliyken Delete veya ⌫ tuşu siler.",
};

export default function Designer() {
  const canvasRef = useRef<MapCanvasHandle>(null);
  const [saved] = useState<Saved | null>(() => loadSaved());
  const [shapes, setShapes] = useState<DrawnShape[]>([]);
  const rawRef = useRef<GeoJSONStoreFeatures[]>([]);
  const hydratedRef = useRef(false);
  const [roofs, setRoofs] = useState<Record<string, RoofMeta>>(saved?.roofs ?? {});
  const [obstacles, setObstacles] = useState<Record<string, ObstacleMeta>>(saved?.obstacles ?? {});
  // Only an explicit choice in "Panel seç" (or a reset) changes the ref; fallbacks are derived in
  // `active` and never written back, so a slow or failed catalogue cannot replace a saved choice.
  const [moduleRef, setModuleRef] = useState<ModuleRef | null>(saved?.moduleRef ?? null);
  const [gapM, setGapM] = useState(saved?.gapM ?? DEFAULT_GAP_M);
  const catalog = useModules();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const pickButtonRef = useRef<HTMLButtonElement>(null);
  const sheetWasOpenRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<DrawMode>("select");
  // Counts refused closes of a crossing shape; a repeat restarts the notice's timer.
  const [drawRejections, setDrawRejections] = useState(0);
  const [estimate, setEstimate] = useState<Estimate>({ status: "idle", rows: [], failed: [], signature: "" });
  // The controller of the estimate in flight doubles as its run id: a reset, a new run or unmount aborts it.
  const estimateRunRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "error" | "empty" | "short">("idle");
  const [searchError, setSearchError] = useState("");
  // Pure layoutFace cache per roof id (see `layouts`). Held in state because refs may not be read during render.
  const [layoutCache] = useState(() => new Map<string, { key: string; res: LayoutResult }>());

  const onShapesChange = useCallback((next: DrawnShape[], raw: GeoJSONStoreFeatures[]) => {
    hydratedRef.current = true;
    rawRef.current = raw;
    setShapes(next);
    setRoofs((prev) => {
      let out = prev;
      let n = highestNumber(prev, /^Çatı (\d+)$/);
      for (const s of next) {
        if (s.kind !== "roof" || prev[s.id]) continue;
        if (out === prev) out = { ...prev };
        n += 1;
        out[s.id] = defaultRoof(`Çatı ${n}`, s.ring);
      }
      return out;
    });
    setObstacles((prev) => {
      let out = prev;
      let n = highestNumber(prev, /^Engel (\d+)$/);
      for (const s of next) {
        if (s.kind !== "obstacle" || prev[s.id]) continue;
        if (out === prev) out = { ...prev };
        n += 1;
        out[s.id] = { name: `Engel ${n}`, heightM: 1.5, clearanceM: 0.5 };
      }
      return out;
    });
  }, []);

  const frame = useMemo(() => {
    const c = meanLonLat(shapes.map((s) => s.ring));
    return c ? localFrame(c[0], c[1]) : null;
  }, [shapes]);

  // The placeholder stands in while the catalogue loads or when it fails.
  const catalogModules = catalog.data?.modules;
  const active = useMemo(
    () => (catalogModules ? resolveModule(moduleRef, catalogModules, ENV_DEFAULT_MODULE_ID) : PLACEHOLDER_MODULE),
    [catalogModules, moduleRef],
  );
  const spec = useMemo(() => moduleSpec(active, gapM), [active, gapM]);

  const obstacleSpecs: ObstacleSpec[] = useMemo(() => {
    if (!frame) return [];
    return shapes
      .filter((s) => s.kind === "obstacle")
      .map((s) => ({ footprint: s.ring.map(frame.toLocal), clearanceM: obstacles[s.id]?.clearanceM ?? 0.5 }));
  }, [frame, shapes, obstacles]);

  const layouts: RoofLayout[] = useMemo(() => {
    if (!frame) return [];
    // Packing a big face takes hundreds of ms, so a face is only repacked when something
    // layoutFace reads has changed (a new module repacks every face), not when a name or another
    // face is edited.
    const sharedKey = JSON.stringify([obstacleSpecs, spec], omitName);
    const out: RoofLayout[] = [];
    for (const s of shapes) {
      const meta = roofs[s.id];
      if (s.kind !== "roof" || !meta) continue;
      const footprint = s.ring.map(frame.toLocal);
      const key = JSON.stringify([footprint, meta], omitName) + sharedKey;
      let cached = layoutCache.get(s.id);
      if (cached?.key !== key) {
        cached = { key, res: layoutFace(footprint, meta, obstacleSpecs, spec) };
        layoutCache.set(s.id, cached);
      }
      out.push({ id: s.id, meta, ring: s.ring, footprint, res: cached.res });
    }
    const live = new Set(out.map((l) => l.id));
    for (const id of layoutCache.keys()) if (!live.has(id)) layoutCache.delete(id);
    return out;
  }, [frame, shapes, roofs, obstacleSpecs, spec, layoutCache]);

  // What "Bu tasarımda" packs candidates into: the same footprints, faces and obstacles as above.
  const design = useMemo<DesignSnapshot | null>(
    () =>
      layouts.length === 0
        ? null
        : {
            faces: layouts.map((l) => ({ id: l.id, name: l.meta.name, footprint: l.footprint, face: faceSpec(l.meta) })),
            obstacles: obstacleSpecs,
            gapM,
          },
    [layouts, obstacleSpecs, gapM],
  );

  const modulesFC = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!frame) return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: layouts.flatMap((l) =>
        l.res.modules.map((m) => {
          const ring = m.map(frame.toLonLat);
          return {
            type: "Feature" as const,
            properties: { roof: l.id },
            geometry: { type: "Polygon" as const, coordinates: [[...ring, ring[0]]] },
          };
        }),
      ),
    };
  }, [frame, layouts]);

  const totals = useMemo(() => {
    const count = layouts.reduce((s, l) => s + l.res.count, 0);
    // A self-intersecting face has no meaningful area; it is flagged in the table instead.
    const surface = layouts.reduce((s, l) => s + (l.res.invalidReason ? 0 : l.res.surfaceAreaM2), 0);
    return { count, kwp: (count * active.wp) / 1000, surface };
  }, [layouts, active.wp]);

  // Persist the design locally once the canvas has restored the saved shapes. A save still
  // waiting when the designer unmounts (the "Tüm paneller" link) is written right away.
  const pendingSaveRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!hydratedRef.current) return;
    const save = () => {
      pendingSaveRef.current = null;
      const ids = new Set(shapes.map((s) => s.id));
      const pick = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => ids.has(k)));
      writeSaved({ version: 2, features: rawRef.current, roofs: pick(roofs), obstacles: pick(obstacles), moduleRef, gapM });
    };
    pendingSaveRef.current = save;
    const t = window.setTimeout(save, 400);
    return () => window.clearTimeout(t);
  }, [shapes, roofs, obstacles, moduleRef, gapM]);
  useEffect(() => () => pendingSaveRef.current?.(), []);

  // Keyboard shortcuts: R roof, E obstacle, V select, Delete or Backspace removes the selection
  // (ignored while typing). Handled here rather than by Terra Draw, which only hears the canvas
  // and only the Delete key, so a Mac's ⌫ or a roof picked from the table would do nothing.
  // Off while the panel sheet is open: its keys belong to the sheet, not to the hidden map.
  useEffect(() => {
    if (sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (canvasRef.current?.deleteSelected()) e.preventDefault();
        return;
      }
      const key = e.key.toLocaleLowerCase("tr-TR");
      if (key === "r") canvasRef.current?.setMode("roof");
      else if (key === "e") canvasRef.current?.setMode("obstacle");
      else if (key === "v") canvasRef.current?.setMode("select");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  // Focus moves into the sheet when it opens (unless the sheet already focused one of its own
  // controls) and back to "Panel seç" when it closes.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (sheetOpen && sheet && !sheet.contains(document.activeElement)) sheet.focus();
    else if (!sheetOpen && sheetWasOpenRef.current) pickButtonRef.current?.focus();
    sheetWasOpenRef.current = sheetOpen;
  }, [sheetOpen]);

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const selectModule = useCallback(
    (record: ModuleRecord) => {
      // The sheet disables "Bu paneli seç" for these; this guards the packer all the same.
      if (!isUsable(record)) return;
      setModuleRef({ id: record.id, version: record.version });
      setSheetOpen(false);
      const label = moduleLabel(record);
      setAnnouncement(design ? `Panel değişti: ${label}. Tüm yüzeyler yeniden yerleştirildi.` : `Panel değişti: ${label}.`);
      // catalog_module_selected is tracked by PanelBrowser, which knows where the click came from.
    },
    [design],
  );

  const onSheetKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // A drawer or tour popover inside the sheet that handles Esc itself marks the event handled.
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    closeSheet();
  };

  const signature = useMemo(
    () =>
      JSON.stringify([
        active.wp,
        layouts.map((l) => [l.id, l.res.count, l.meta.kind, l.meta.tiltDeg, l.meta.rackTiltDeg, l.meta.azimuthDeg]),
      ]),
    [layouts, active.wp],
  );

  useEffect(() => () => estimateRunRef.current?.abort(), []);

  useEffect(() => {
    if (drawRejections === 0) return;
    const t = window.setTimeout(() => setDrawRejections(0), 5000);
    return () => window.clearTimeout(t);
  }, [drawRejections]);

  const runEstimate = async () => {
    const targets = layouts.filter((l) => l.res.count > 0);
    if (targets.length === 0) return;
    estimateRunRef.current?.abort();
    const run = new AbortController();
    estimateRunRef.current = run;
    setEstimate({ status: "loading", rows: [], failed: [], signature });
    const rows: EstimateRow[] = [];
    const failed: EstimateFailure[] = [];
    let radiationDb: string | null = null;
    // Faces are fetched one by one and a failing face is listed, not allowed to drop the others.
    for (const l of targets) {
      const [lon, lat] = centroid(l.ring);
      const params = new URLSearchParams({
        lat: lat.toFixed(5),
        lon: lon.toFixed(5),
        kwp: l.res.kwp.toFixed(3),
        tilt: String(l.meta.kind === "pitched" ? l.meta.tiltDeg : l.meta.rackTiltDeg),
        azimuth: String(l.meta.azimuthDeg),
        // PVGIS "building" means fully integrated with no air behind the modules; rail-mounted
        // roofs are ventilated, so "free" is the closer model. The note under the result says so.
        mounting: "free",
      });
      try {
        const body = await getJson<{ annualKwh?: unknown; radiationDb?: string | null }>(`/api/pvgis?${params}`, run.signal);
        if (typeof body.annualKwh !== "number") throw new Error(UNEXPECTED_RESPONSE);
        radiationDb = body.radiationDb ?? radiationDb;
        rows.push({ id: l.id, name: l.meta.name, kind: l.meta.kind, kwp: l.res.kwp, annualKwh: body.annualKwh });
      } catch (e) {
        if (run.signal.aborted) return;
        failed.push({ id: l.id, name: l.meta.name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (run.signal.aborted) return;
    estimateRunRef.current = null;
    setEstimate({ status: rows.length > 0 ? "done" : "error", rows, failed, signature, radiationDb });
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchState("short");
      return;
    }
    setSearchState("loading");
    try {
      const body = await getJson<{ results?: SearchResult[] }>(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!Array.isArray(body.results)) throw new Error(UNEXPECTED_RESPONSE);
      setResults(body.results);
      setSearchState(body.results.length === 0 ? "empty" : "idle");
    } catch (err) {
      setResults([]);
      setSearchError(err instanceof Error ? err.message : String(err));
      setSearchState("error");
    }
  };

  const selectedShape = shapes.find((s) => s.id === selectedId) ?? null;
  const selectedLayout = layouts.find((l) => l.id === selectedId) ?? null;
  const updateRoof = (id: string, patch: Partial<RoofMeta>) => setRoofs((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const updateObstacle = (id: string, patch: Partial<ObstacleMeta>) => setObstacles((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const estimateTotal = estimate.rows.reduce((s, r) => s + r.annualKwh, 0);
  const estimateKwp = estimate.rows.reduce((s, r) => s + r.kwp, 0);
  const stale = estimate.status === "done" && estimate.signature !== signature;

  const toolButton = (m: DrawMode, label: string, key: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => canvasRef.current?.setMode(m)}
      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${
        mode === m ? "border-amber-400 bg-amber-400/10 text-amber-300" : "border-neutral-700 hover:bg-neutral-800"
      }`}
    >
      {label}
      <kbd className="rounded bg-neutral-800 px-1.5 text-[10px] text-neutral-400">{key}</kbd>
    </button>
  );

  return (
    <div className="flex h-dvh w-full flex-col bg-neutral-950 text-neutral-100 md:flex-row">
      {/* Outside both inert areas, so the change is announced while the sheet closes. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <aside
        inert={sheetOpen}
        className="order-2 h-[45dvh] w-full shrink-0 overflow-y-auto border-neutral-800 md:order-1 md:h-auto md:w-[380px] md:border-r"
      >
        <header className="px-4 pb-4 pt-5">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">GESPlan</h1>
            <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
              Prototip
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-400">Çatıyı çizin, modüller otomatik yerleşsin.</p>
        </header>

        <Section title="Konum">
          <form onSubmit={search} className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-amber-400"
              placeholder="Adres veya yer adı (ör. Konya OSB)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="rounded-md bg-neutral-800 px-3 text-sm hover:bg-neutral-700">
              {searchState === "loading" ? "…" : "Ara"}
            </button>
          </form>
          {searchState === "error" ? <p className="mt-2 text-xs text-red-400">{searchError}</p> : null}
          {searchState === "empty" ? <p className="mt-2 text-xs text-neutral-400">Sonuç bulunamadı.</p> : null}
          {searchState === "short" ? <p className="mt-2 text-xs text-neutral-400">En az 2 karakter yazın.</p> : null}
          {results.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {results.map((r) => (
                <li key={`${r.lat},${r.lon}`}>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                    onClick={() => {
                      canvasRef.current?.flyTo(r.lon, r.lat, 18);
                      setResults([]);
                    }}
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title="Çizim">
          <div className="grid gap-2">
            {toolButton("roof", "Çatı yüzeyi çiz", "R")}
            {toolButton("obstacle", "Engel çiz", "E")}
            {toolButton("select", "Seç ve düzenle", "V")}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-neutral-400">{HINTS[mode]}</p>
        </Section>

        <Section title="Özet">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Modül" value={fmt(totals.count)} />
            <Stat label="Kurulu güç" value={fmt(totals.kwp, 1)} unit="kWp" />
            <Stat label="Çatı yüzey alanı" value={fmt(totals.surface)} unit="m²" />
            <Stat label="Yüzey" value={fmt(layouts.length)} />
          </div>
          {layouts.length > 0 ? (
            <table className="mt-3 w-full text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="py-1 text-left font-normal">Yüzey</th>
                  <th className="py-1 text-right font-normal">Modül</th>
                  <th className="py-1 text-right font-normal">kWp</th>
                  <th className="py-1 text-right font-normal">Yön</th>
                </tr>
              </thead>
              <tbody>
                {layouts.map((l) => {
                  const selected = l.id === selectedId;
                  const az = shownAzimuth(l.meta.azimuthDeg);
                  return (
                    <tr
                      key={l.id}
                      className={`cursor-pointer border-t border-neutral-800 hover:bg-neutral-900 ${selected ? "text-amber-300" : ""}`}
                      onClick={() => canvasRef.current?.select(l.id)}
                    >
                      <td className="py-1.5">
                        {/* The row click is a mouse shortcut; this button is what keyboards and screen readers use. */}
                        <button
                          type="button"
                          className={`w-full text-left ${selected ? "font-medium" : ""}`}
                          aria-current={selected ? "true" : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            canvasRef.current?.select(l.id);
                          }}
                        >
                          {selected ? <span aria-hidden="true">▸ </span> : null}
                          {l.meta.name}
                          {l.res.invalidReason === "self-intersecting" ? (
                            <span className="ml-1.5 text-[10px] font-normal text-red-400">kenarlar kesişiyor</span>
                          ) : null}
                        </button>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{fmt(l.res.count)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmt(l.res.kwp, 1)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {fmt(az)}° {compass(az)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="mt-3 text-xs text-neutral-500">Henüz çatı yüzeyi yok. Konumu bulun ve &quot;Çatı yüzeyi çiz&quot; ile başlayın.</p>
          )}
        </Section>

        {selectedShape?.kind === "roof" && roofs[selectedShape.id] ? (
          <RoofEditor
            // keyed so a half-typed value or a field note never carries over to another roof
            key={selectedShape.id}
            meta={roofs[selectedShape.id]}
            layout={selectedLayout}
            onChange={(patch) => updateRoof(selectedShape.id, patch)}
            onDelete={() => canvasRef.current?.removeShape(selectedShape.id)}
          />
        ) : null}
        {selectedShape?.kind === "obstacle" && obstacles[selectedShape.id] ? (
          <Section
            key={selectedShape.id}
            title="Seçili engel"
            aside={
              <button type="button" className="text-xs text-red-400 hover:text-red-300" onClick={() => canvasRef.current?.removeShape(selectedShape.id)}>
                Sil
              </button>
            }
          >
            <div className="grid gap-3">
              <TextField label="Ad" value={obstacles[selectedShape.id].name} onChange={(v) => updateObstacle(selectedShape.id, { name: v })} />
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Güvenlik mesafesi"
                  unit="m"
                  min={0}
                  max={10}
                  value={obstacles[selectedShape.id].clearanceM}
                  onChange={(v) => updateObstacle(selectedShape.id, { clearanceM: v })}
                />
                <NumberField
                  label="Yükseklik"
                  unit="m"
                  min={0}
                  max={50}
                  value={obstacles[selectedShape.id].heightM}
                  onChange={(v) => updateObstacle(selectedShape.id, { heightM: v })}
                  hint="Gölge hesabı bir sonraki adım"
                />
              </div>
            </div>
          </Section>
        ) : null}

        <Section
          title="Modül"
          aside={
            active.placeholder ? (
              <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300">Yer tutucu</span>
            ) : active.record && !active.record.verified ? (
              <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300">veri doğrulanmadı</span>
            ) : null
          }
        >
          <div className="grid gap-3">
            <div className="rounded-md bg-neutral-900 px-3 py-2">
              {active.record ? <p className="text-[11px] text-neutral-500">{active.record.brand}</p> : null}
              <p className="text-sm font-medium">{active.label}</p>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-neutral-500">Güç</dt>
                <dd className="tabular-nums">{fmt(active.wp)} W</dd>
                <dt className="text-neutral-500">Boyut</dt>
                <dd className="tabular-nums">
                  {fmt(Math.round(active.lengthM * 1000))} × {fmt(Math.round(active.widthM * 1000))} mm
                </dd>
              </dl>
            </div>
            {catalog.isPending ? <p className="text-xs text-neutral-400">Panel kataloğu yükleniyor…</p> : null}
            {catalog.isError ? (
              <div className="text-xs text-red-400">
                {/* A failed background refresh keeps the list that loaded before, and its module. */}
                <p>
                  {asSentence(catalog.error.message)} {catalogModules ? "Son yüklenen katalog kullanılıyor." : "Yer tutucu modül kullanılıyor."}
                </p>
                <button
                  type="button"
                  disabled={catalog.isFetching}
                  onClick={() => void catalog.refetch()}
                  className="mt-1.5 rounded border border-neutral-700 px-2 py-1 text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-500"
                >
                  {catalog.isFetching ? "Deneniyor…" : "Tekrar dene"}
                </button>
              </div>
            ) : null}
            {catalogModules && moduleRef && moduleRef.id !== PLACEHOLDER_MODULE.ref.id && active.ref.id !== moduleRef.id ? (
              <p className="text-xs text-amber-300">Kayıtlı panel katalogda yok ya da kullanılamıyor; varsayılan panel kullanılıyor.</p>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <button
                ref={pickButtonRef}
                type="button"
                aria-haspopup="dialog"
                onClick={() => setSheetOpen(true)}
                className="rounded-md border border-amber-400/60 px-3 py-1.5 text-sm text-amber-300 transition-colors hover:bg-amber-400/10"
              >
                Panel seç
              </button>
              <Link href="/paneller" className="text-xs text-neutral-300 underline underline-offset-2 hover:text-neutral-100">
                Tüm paneller
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Modül arası boşluk"
                unit="m"
                digits={3}
                min={0}
                max={1}
                value={gapM}
                onChange={setGapM}
                hint="Komşu modüller arası; sıra aralığı değil"
              />
            </div>
            <p className="text-[11px] leading-relaxed text-neutral-500">
              {active.placeholder
                ? "Yer tutucu değerler gerçek bir ürüne ait değildir. Teklif için boyut ve güç verisi olan bir panel seçilmeli ve değerler ikinci bir kişi tarafından kontrol edilmelidir."
                : "Ürün verileri üreticinin yayınladığı teknik dokümanlardan alınmıştır; doğrulanana kadar bilgi amaçlıdır."}
            </p>
          </div>
        </Section>

        <Section title="Üretim tahmini">
          <button
            type="button"
            disabled={totals.count === 0 || estimate.status === "loading"}
            onClick={runEstimate}
            className="w-full rounded-md bg-amber-400 px-3 py-2 text-sm font-medium text-neutral-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            {estimate.status === "loading" ? "PVGIS hesaplıyor…" : "PVGIS ile yıllık üretimi tahmin et"}
          </button>
          {estimate.status === "error" ? (
            <ul className="mt-2 space-y-0.5 text-xs text-red-400">
              {/* When every face failed for the same reason (usually the connection), say it once. */}
              {estimate.failed.every((f) => f.error === estimate.failed[0].error) ? (
                <li>{estimate.failed[0].error}</li>
              ) : (
                estimate.failed.map((f) => (
                  <li key={f.id}>
                    {f.name}: {f.error}
                  </li>
                ))
              )}
            </ul>
          ) : null}
          {estimate.status === "done" ? (
            <div className={`mt-3 ${stale ? "opacity-50" : ""}`}>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Yıllık üretim" value={fmt(estimateTotal / 1000, 1)} unit="MWh" />
                <Stat label="Özgül verim" value={fmt(estimateKwp > 0 ? estimateTotal / estimateKwp : 0)} unit="kWh/kWp" />
              </div>
              {stale ? <p className="mt-2 text-xs text-amber-300">Tasarım değişti; tahmini yenileyin.</p> : null}
              {estimate.failed.length > 0 ? (
                <div className="mt-2 text-xs text-red-400">
                  <p>Hesaplanamayan yüzeyler toplama dahil değil:</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {estimate.failed.map((f) => (
                      <li key={f.id}>
                        {f.name}: {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                PVGIS 5.3 ({estimate.radiationDb ?? "SARAH3"}) kendi modeliyle hesaplanmıştır. %14 sistem kaybı kablo, evirici ve kirlenme
                kayıplarını kapsar; engel ve sıra arası gölge ile belirli bir evirici modeli dahil değildir.
                {estimate.rows.some((r) => r.kind === "pitched")
                  ? " Çatıya paralel modüller PVGIS'in serbest montaj varsayımından daha sıcak çalışır, bu yüzden gerçek üretim yüzde birkaç daha düşük olabilir."
                  : null}{" "}
                Karşılaştırma içindir, teklif değeri değildir.
              </p>
            </div>
          ) : null}
        </Section>

        <footer className="border-t border-neutral-800 px-4 py-4 text-[11px] leading-relaxed text-neutral-500">
          <p>
            Prototip: çizimler yalnızca bu tarayıcıda saklanır. Adres araması OpenStreetMap Nominatim&apos;e, üretim tahmini için çatı konumu
            PVGIS&apos;e (AB Ortak Araştırma Merkezi) gönderilir.
          </p>
          <button
            type="button"
            className="mt-2 text-red-400 hover:text-red-300"
            onClick={() => {
              if (!window.confirm("Tüm çizimler ve ayarlar silinsin mi?")) return;
              estimateRunRef.current?.abort();
              estimateRunRef.current = null;
              canvasRef.current?.clearAll();
              setRoofs({});
              setObstacles({});
              setModuleRef(null);
              setGapM(DEFAULT_GAP_M);
              setEstimate({ status: "idle", rows: [], failed: [], signature: "" });
              writeSaved(null);
            }}
          >
            Tasarımı sıfırla
          </button>
        </footer>
      </aside>

      <div className="relative order-1 h-[55dvh] flex-1 md:order-2 md:h-auto">
        <div inert={sheetOpen} className="h-full w-full">
          <MapCanvas
            ref={canvasRef}
            initialFeatures={saved?.features ?? null}
            modules={modulesFC}
            onShapesChange={onShapesChange}
            onSelectionChange={setSelectedId}
            onModeChange={(m) => {
              setMode(m);
              setDrawRejections(0);
            }}
            onDrawRejected={() => setDrawRejections((n) => n + 1)}
          />
          {mode !== "select" ? (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-neutral-950/85 px-4 py-1.5 text-xs text-neutral-200 shadow">
              {mode === "roof" ? "Çatı çiziliyor" : "Engel çiziliyor"} · Enter bitirir, Esc iptal
            </div>
          ) : null}
          {/* Without this a refused close looks like a click that did nothing. */}
          <div aria-live="polite" className="pointer-events-none absolute left-1/2 top-12 w-max max-w-[90%] -translate-x-1/2">
            {drawRejections > 0 ? (
              <p className="rounded-md bg-red-950/90 px-3 py-1.5 text-center text-xs text-red-200 shadow">
                Kenarlar kesişiyor. Köşeleri kenar boyunca sırayla tıklayın ya da Esc ile iptal edin.
              </p>
            ) : null}
          </div>
          {totals.count > 0 ? (
            <div className="pointer-events-none absolute bottom-8 left-3 rounded-md bg-neutral-950/85 px-3 py-2 text-sm tabular-nums shadow">
              {fmt(totals.count)} modül · {fmt(totals.kwp, 1)} kWp
            </div>
          ) : null}
        </div>
        {sheetOpen ? (
          // Full screen on phones; on wider screens it covers the map beside the (inert) sidebar.
          <div className="fixed inset-0 z-40 flex md:absolute">
            <div
              ref={sheetRef}
              role="dialog"
              aria-modal="true"
              // Labelled by PanelSelection's heading; the aria-label is a fallback if it is ever missing.
              aria-labelledby={PANEL_SELECTION_TITLE_ID}
              aria-label="Panel seçimi"
              tabIndex={-1}
              onKeyDown={onSheetKeyDown}
              className="h-full w-full overflow-y-auto overscroll-contain bg-neutral-950 outline-none md:w-[min(40rem,100%)] md:border-r md:border-neutral-800 md:shadow-2xl"
            >
              <PanelSelection design={design} active={active} onSelect={selectModule} onClose={closeSheet} />
            </div>
            <div aria-hidden="true" className="hidden min-w-0 flex-1 bg-neutral-950/50 md:block" onClick={closeSheet} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RoofEditor(props: { meta: RoofMeta; layout: RoofLayout | null; onChange(patch: Partial<RoofMeta>): void; onDelete(): void }) {
  const { meta, layout, onChange } = props;
  const edges = layout ? edgeLengths(layout.footprint) : [];
  const az = shownAzimuth(meta.azimuthDeg, 1);
  const res = layout?.res ?? null;
  const invalid = res?.invalidReason === "self-intersecting";
  return (
    <Section
      title="Seçili çatı yüzeyi"
      aside={
        <button type="button" className="text-xs text-red-400 hover:text-red-300" onClick={props.onDelete}>
          Sil
        </button>
      }
    >
      <div className="grid gap-3">
        <TextField label="Ad" value={meta.name} onChange={(v) => onChange({ name: v })} />
        <Segmented
          label="Çatı tipi"
          value={meta.kind}
          options={[
            { value: "pitched", label: "Eğimli (paralel)" },
            { value: "flat", label: "Düz (konstrüksiyon)" },
          ]}
          onChange={(v) => onChange({ kind: v })}
        />
        <div className="grid grid-cols-2 gap-3">
          {meta.kind === "pitched" ? (
            <NumberField label="Çatı eğimi" unit="°" digits={1} min={0} max={60} value={meta.tiltDeg} onChange={(v) => onChange({ tiltDeg: v })} />
          ) : (
            <NumberField label="Konstrüksiyon eğimi" unit="°" digits={1} min={0} max={40} value={meta.rackTiltDeg} onChange={(v) => onChange({ rackTiltDeg: v })} />
          )}
          <NumberField
            label={meta.kind === "pitched" ? "Yön (azimut)" : "Modül yönü"}
            unit={`° ${compass(az)}`}
            digits={1}
            min={0}
            max={359.9}
            outOfRange="reject"
            value={az}
            onChange={(v) => onChange({ azimuthDeg: v })}
            hint="Kuzey 0°, doğu 90°, güney 180°, batı 270°. PVGIS'te güney 0° kabul edilir, burada 180°."
          />
        </div>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800"
            onClick={() => layout && onChange({ azimuthDeg: suggestAzimuth(layout.footprint) })}
          >
            Kenara göre öner
          </button>
          <button
            type="button"
            className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800"
            onClick={() => onChange({ azimuthDeg: (meta.azimuthDeg + 180) % 360 })}
          >
            Ters çevir
          </button>
          {meta.kind === "flat" ? (
            <button type="button" className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800" onClick={() => onChange({ azimuthDeg: 180 })}>
              Güney
            </button>
          ) : null}
        </div>
        {meta.kind === "flat" ? (
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Gölge sınır açısı"
              unit="°"
              digits={1}
              min={5}
              max={45}
              value={meta.limitElevationDeg}
              onChange={(v) => onChange({ limitElevationDeg: v })}
              hint="Bu güneş yüksekliğinin üstünde sıralar birbirini gölgelemez"
            />
            <Segmented
              label="Masa başına sıra"
              value={meta.rowsPerTable}
              options={[
                { value: 1, label: "1" },
                { value: 2, label: "2" },
              ]}
              onChange={(v) => onChange({ rowsPerTable: v })}
            />
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Kenar boşluğu" unit="m" digits={2} min={0} max={10} value={meta.setbackM} onChange={(v) => onChange({ setbackM: v })} />
          <Segmented
            label="Yerleşim"
            value={meta.orientation}
            options={[
              { value: "portrait", label: "Dikey" },
              { value: "landscape", label: "Yatay" },
            ]}
            onChange={(v) => onChange({ orientation: v })}
          />
        </div>
        {res && !invalid ? (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Modül" value={fmt(res.count)} />
            <Stat label="Güç" value={fmt(res.kwp, 1)} unit="kWp" />
            <Stat label="Yüzey alanı" value={fmt(res.surfaceAreaM2)} unit="m²" />
            {res.gcr !== null ? (
              <Stat label="GCR · sıra aralığı" value={`${fmt(res.gcr, 2)} · ${fmt(res.pitchM ?? 0, 2)}`} unit="m" />
            ) : (
              <Stat label="Alan kullanımı" value={fmt(res.utilisation * 100)} unit="%" />
            )}
          </div>
        ) : null}
        {!res ? null : invalid ? (
          <p className="text-xs text-red-400">
            Bu yüzeyin kenarları kesişiyor. Köşeleri sürükleyerek düzeltin ya da yüzeyi silip yeniden çizin.
          </p>
        ) : res.count === 0 && res.removedByObstacles > 0 ? (
          <p className="text-xs text-amber-300">
            Engeller bu yüzeydeki tüm modül yerlerini kapatıyor; engelin boyutunu veya güvenlik mesafesini kontrol edin.
          </p>
        ) : res.count === 0 ? (
          <p className="text-xs text-amber-300">Bu yüzeye modül sığmadı: kenar boşluğunu, yönü veya yerleşimi kontrol edin.</p>
        ) : res.removedByObstacles > 0 ? (
          <p className="text-xs text-neutral-400">Engeller nedeniyle {fmt(res.removedByObstacles)} modül yeri kullanılamadı.</p>
        ) : null}
        {edges.length > 0 ? (
          <div>
            <span className="text-xs text-neutral-400">Kenar uzunlukları (yatay izdüşüm)</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {edges.map((e, i) => (
                <span key={i} className="rounded bg-neutral-900 px-1.5 py-0.5 text-[11px] tabular-nums text-neutral-300">
                  {i + 1}: {fmt(e, 2)} m
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
