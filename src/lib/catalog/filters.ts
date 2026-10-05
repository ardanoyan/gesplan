/**
 * Catalogue search, filters and sort, kept in the URL so a filtered list can be shared or
 * reloaded. Pure functions; the UI owns no filter logic of its own.
 *
 * URL params (ASCII names): q, tek (topcon,perc,unknown), min, max (W), bf (evet|hayir),
 * cerceve (frame colours), sirala (guc|verim|boyut), yon (artan|azalan). Defaults are left out
 * and malformed values fall back to the default, so an old or hand-edited link still opens.
 */
import type { ModuleRecord, Technology } from "./schema";

export type SortKey = "power" | "efficiency" | "size";

export interface CatalogFilters {
  /** Free text matched against series and model (Turkish-aware, case-insensitive). */
  q: string;
  technology: Technology[];
  /** Watts; a record matches when its power (or published range) overlaps [minW, maxW]. */
  minW: number | null;
  maxW: number | null;
  bifacial: "any" | "yes" | "no";
  frame: string[];
  sort: SortKey;
  dir: "asc" | "desc";
}

export const DEFAULT_FILTERS: CatalogFilters = {
  q: "",
  technology: [],
  minW: null,
  maxW: null,
  bifacial: "any",
  frame: [],
  sort: "power",
  dir: "desc",
};

/** Rated power, or the published range for series-level records; null when neither is known. */
export function powerRange(m: ModuleRecord): { min: number; max: number } | null {
  if (m.p_max_w !== null) return { min: m.p_max_w, max: m.p_max_w };
  return m.p_max_range_w;
}

const TECHNOLOGIES: readonly Technology[] = ["topcon", "perc", "unknown"];
const SORT_PARAM: Record<SortKey, string> = { power: "guc", efficiency: "verim", size: "boyut" };
const DIR_PARAM: Record<CatalogFilters["dir"], string> = { asc: "artan", desc: "azalan" };
const BIFACIAL_PARAM = { yes: "evet", no: "hayir" } as const;
const MAX_QUERY_LENGTH = 100;

/**
 * Folds case and diacritics the Turkish way: "SERİES", "serıes" and "series" all become
 * "series". Turkish lower-casing maps I to dotless ı, which NFD does not decompose, so ı is
 * folded to i by hand after the combining marks are stripped.
 */
function fold(s: string): string {
  return s.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
}

function list(raw: string | null): string[] {
  if (raw === null) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

/** Non-negative watts written as plain digits (optionally with a dot decimal); anything else is null. */
function watts(raw: string | null): number | null {
  if (raw === null || !/^\d{1,6}(\.\d+)?$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

function keyOf<K extends string>(map: Record<K, string>, raw: string | null): K | undefined {
  return (Object.keys(map) as K[]).find((k) => map[k] === raw);
}

export function parseFilters(params: URLSearchParams): CatalogFilters {
  const tek = new Set(list(params.get("tek")));
  const bf = params.get("bf");
  return {
    q: (params.get("q") ?? "").slice(0, MAX_QUERY_LENGTH),
    technology: TECHNOLOGIES.filter((t) => tek.has(t)),
    minW: watts(params.get("min")),
    maxW: watts(params.get("max")),
    bifacial: bf === BIFACIAL_PARAM.yes ? "yes" : bf === BIFACIAL_PARAM.no ? "no" : DEFAULT_FILTERS.bifacial,
    frame: list(params.get("cerceve")),
    sort: keyOf(SORT_PARAM, params.get("sirala")) ?? DEFAULT_FILTERS.sort,
    dir: keyOf(DIR_PARAM, params.get("yon")) ?? DEFAULT_FILTERS.dir,
  };
}

/** Omits values equal to the defaults so a clean list has a clean URL. */
export function filtersToParams(f: CatalogFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim() !== "") p.set("q", f.q);
  const tech = TECHNOLOGIES.filter((t) => f.technology.includes(t));
  if (tech.length > 0) p.set("tek", tech.join(","));
  if (f.minW !== null) p.set("min", String(f.minW));
  if (f.maxW !== null) p.set("max", String(f.maxW));
  if (f.bifacial !== "any") p.set("bf", BIFACIAL_PARAM[f.bifacial]);
  const frame = [...new Set(f.frame.map((s) => s.trim()).filter(Boolean))];
  if (frame.length > 0) p.set("cerceve", frame.join(","));
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sirala", SORT_PARAM[f.sort]);
  if (f.dir !== DEFAULT_FILTERS.dir) p.set("yon", DIR_PARAM[f.dir]);
  return p;
}

function sortValue(m: ModuleRecord, key: SortKey): number | null {
  if (key === "power") return powerRange(m)?.max ?? null;
  if (key === "efficiency") return m.efficiency_pct ?? m.efficiency_max_pct;
  return m.length_mm !== null && m.width_mm !== null ? m.length_mm * m.width_mm : null;
}

/** Filters then sorts; records missing the sort value go last in either direction. */
export function applyFilters(modules: ModuleRecord[], f: CatalogFilters): ModuleRecord[] {
  const terms = fold(f.q).split(/\s+/).filter(Boolean);
  const tech = new Set(f.technology);
  const frames = new Set(f.frame.map((s) => fold(s.trim())).filter(Boolean));
  // A reversed range (min above max while typing) still means "between these two".
  let lo = f.minW;
  let hi = f.maxW;
  if (lo !== null && hi !== null && lo > hi) [lo, hi] = [hi, lo];

  const kept = modules.filter((m) => {
    if (terms.length > 0) {
      const hay = fold([m.series, m.model].filter(Boolean).join(" "));
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (tech.size > 0 && !tech.has(m.technology)) return false;
    if (lo !== null || hi !== null) {
      const r = powerRange(m);
      if (!r) return false;
      if (lo !== null && r.max < lo) return false;
      if (hi !== null && r.min > hi) return false;
    }
    if (f.bifacial === "yes" && m.bifacial !== true) return false;
    if (f.bifacial === "no" && m.bifacial !== false) return false;
    if (frames.size > 0 && (m.frame_color === null || !frames.has(fold(m.frame_color.trim())))) return false;
    return true;
  });

  const sign = f.dir === "asc" ? 1 : -1;
  return kept
    .map((m) => ({ m, v: sortValue(m, f.sort) }))
    .sort((a, b) => {
      if (a.v !== b.v) {
        if (a.v === null) return 1;
        if (b.v === null) return -1;
        return (a.v - b.v) * sign;
      }
      return a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : 0;
    })
    .map(({ m }) => m);
}

/** Distinct non-null frame colours (case-insensitive, first spelling kept), for the frame filter's options. */
export function frameColours(modules: ModuleRecord[]): string[] {
  const seen = new Map<string, string>();
  for (const m of modules) {
    const c = m.frame_color?.trim();
    if (c && !seen.has(fold(c))) seen.set(fold(c), c);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "tr-TR"));
}
