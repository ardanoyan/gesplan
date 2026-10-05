import { describe, expect, it } from "vitest";
import fixture from "../../../e2e/fixtures/catalog-fixture.json";
import { DEFAULT_FILTERS, parseFilters } from "@/lib/catalog/filters";
import { catalogFileSchema } from "@/lib/catalog/schema";
import { activeFilterCount, catalogPowerBounds, isDefaultFilters, mergeFilterQuery } from "./filter-state";

// Fake TEST-FIXTURE records only; never Kıvanç data.
const modules = catalogFileSchema.parse(fixture).modules;

describe("mergeFilterQuery", () => {
  it("gives a clean query for default filters", () => {
    expect(mergeFilterQuery("", DEFAULT_FILTERS)).toBe("");
  });
  it("round-trips through parseFilters", () => {
    const next = { ...DEFAULT_FILTERS, q: "topcon", technology: ["perc" as const], minW: 450, bifacial: "no" as const };
    expect(parseFilters(new URLSearchParams(mergeFilterQuery("", next)))).toEqual(next);
  });
  it("keeps params the filters do not own and replaces the ones they do", () => {
    const current = mergeFilterQuery("panel=1", { ...DEFAULT_FILTERS, technology: ["topcon"], frame: ["black"] });
    const qs = new URLSearchParams(mergeFilterQuery(current, { ...DEFAULT_FILTERS, q: "fx" }));
    expect(qs.get("panel")).toBe("1");
    expect(parseFilters(qs)).toEqual({ ...DEFAULT_FILTERS, q: "fx" });
  });
});

describe("filter summaries", () => {
  it("counts active filters but not search or sort", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, q: "x", sort: "size" })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, technology: ["topcon", "perc"], maxW: 500, bifacial: "yes", frame: ["black"] })).toBe(4);
  });
  it("treats search and sort as non-default for the reset button", () => {
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, q: "  " })).toBe(true);
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, q: "fx" })).toBe(false);
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, dir: "asc" })).toBe(false);
  });
});

describe("catalogPowerBounds", () => {
  it("spans rated powers and published ranges", () => {
    expect(catalogPowerBounds(modules)).toEqual({ min: 450, max: 600 });
  });
  it("is null when no record gives any power", () => {
    expect(catalogPowerBounds(modules.map((m) => ({ ...m, p_max_w: null, p_max_range_w: null })))).toBeNull();
    expect(catalogPowerBounds([])).toBeNull();
  });
});
