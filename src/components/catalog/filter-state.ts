/**
 * Glue between the catalogue filters and the browser: which URL keys they own, how a change is
 * written back without touching other query params, and the small summaries the UI shows.
 * The filter semantics themselves live in src/lib/catalog/filters.ts.
 */
import { DEFAULT_FILTERS, filtersToParams, powerRange, type CatalogFilters } from "@/lib/catalog/filters";
import type { ModuleRecord } from "@/lib/catalog/schema";

// Every URL key the filters use, found by serialising a filter set where nothing is default,
// so this follows filters.ts if a key is renamed.
const FILTER_KEYS = [
  ...filtersToParams({ q: "x", technology: ["topcon"], minW: 1, maxW: 2, bifacial: "yes", frame: ["x"], sort: "efficiency", dir: "asc" }).keys(),
];

/** The query string for `next`, keeping any param the filters do not own. */
export function mergeFilterQuery(current: string, next: CatalogFilters): string {
  const params = new URLSearchParams(current);
  for (const k of FILTER_KEYS) params.delete(k);
  for (const [k, v] of filtersToParams(next)) params.set(k, v);
  return params.toString();
}

/** How many filters differ from the defaults (search and sort excluded), for the disclosure badge. */
export function activeFilterCount(f: CatalogFilters): number {
  return (
    (f.technology.length > 0 ? 1 : 0) +
    (f.minW !== null || f.maxW !== null ? 1 : 0) +
    (f.bifacial !== "any" ? 1 : 0) +
    (f.frame.length > 0 ? 1 : 0)
  );
}

export function isDefaultFilters(f: CatalogFilters): boolean {
  return f.q.trim() === "" && activeFilterCount(f) === 0 && f.sort === DEFAULT_FILTERS.sort && f.dir === DEFAULT_FILTERS.dir;
}

/** Lowest and highest published power in whole watts, for the power fields; null when none is known. */
export function catalogPowerBounds(modules: ModuleRecord[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const m of modules) {
    const r = powerRange(m);
    if (!r) continue;
    min = Math.min(min, r.min);
    max = Math.max(max, r.max);
  }
  return Number.isFinite(min) ? { min: Math.floor(min), max: Math.ceil(max) } : null;
}
