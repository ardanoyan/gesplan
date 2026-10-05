import { describe, expect, it } from "vitest";
import fixtureJson from "../../../e2e/fixtures/catalog-fixture.json";
import { DEFAULT_FILTERS, applyFilters, filtersToParams, frameColours, parseFilters, powerRange, type CatalogFilters } from "./filters";
import { catalogFileSchema, type ModuleRecord } from "./schema";

// Fake test data (brand TEST-FIXTURE), never Kıvanç data.
const FIXTURE = catalogFileSchema.parse(fixtureJson);
const MODULES = FIXTURE.modules;
const record = (id: string) => {
  const m = MODULES.find((r) => r.id === id);
  if (!m) throw new Error(`fixture has no ${id}`);
  return m;
};
const SERIES = record("fixture-series-only");
/** A series record with neither a rated power nor a range. */
const NO_POWER: ModuleRecord = { ...SERIES, id: "fixture-no-power", series: "Fixture Bilinmeyen", p_max_range_w: null, efficiency_max_pct: null };

const filters = (patch: Partial<CatalogFilters>): CatalogFilters => ({ ...DEFAULT_FILTERS, ...patch });
const ids = (list: ModuleRecord[]) => list.map((m) => m.id);
const run = (patch: Partial<CatalogFilters>, modules: ModuleRecord[] = MODULES) => ids(applyFilters(modules, filters(patch)));

describe("URL params", () => {
  it("gives the defaults a clean URL and parses an empty one back to the defaults", () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("");
    expect(parseFilters(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
    expect(filtersToParams(filters({ q: "   " })).toString()).toBe("");
  });

  it("round-trips every filter", () => {
    const f: CatalogFilters = {
      q: "Fixture TOPCon",
      technology: ["topcon", "perc"],
      minW: 450,
      maxW: 600.5,
      bifacial: "yes",
      frame: ["silver", "black"],
      sort: "efficiency",
      dir: "asc",
    };
    const params = filtersToParams(f);
    expect(params.toString()).toBe(
      "q=Fixture+TOPCon&tek=topcon%2Cperc&min=450&max=600.5&bf=evet&cerceve=silver%2Cblack&sirala=verim&yon=artan",
    );
    expect(parseFilters(new URLSearchParams(params.toString()))).toEqual(f);
  });

  it("uses the ASCII Turkish names for the remaining values", () => {
    expect(filtersToParams(filters({ bifacial: "no", sort: "size", dir: "desc" })).toString()).toBe("bf=hayir&sirala=boyut");
    expect(filtersToParams(filters({ technology: ["unknown"], sort: "power", dir: "asc" })).toString()).toBe("tek=unknown&yon=artan");
    expect(parseFilters(new URLSearchParams("sirala=guc&yon=azalan"))).toEqual(DEFAULT_FILTERS);
  });

  it("writes and reads technologies in a fixed order without repeats", () => {
    expect(parseFilters(new URLSearchParams("tek=perc,topcon,perc")).technology).toEqual(["topcon", "perc"]);
    expect(filtersToParams(filters({ technology: ["perc", "topcon"] })).get("tek")).toBe("topcon,perc");
  });

  it("falls back to the default for each malformed value", () => {
    const f = parseFilters(new URLSearchParams("tek=hjt,perc,&min=-5&max=1e3&bf=belki&sirala=fiyat&yon=yukari&cerceve=,"));
    expect(f).toEqual(filters({ technology: ["perc"] }));
    expect(parseFilters(new URLSearchParams("min=abc&max=")).minW).toBeNull();
    expect(parseFilters(new URLSearchParams("min=500,5")).minW).toBeNull();
    expect(parseFilters(new URLSearchParams("tek=HJT")).technology).toEqual([]);
  });

  it("caps an oversized search text", () => {
    expect(parseFilters(new URLSearchParams({ q: "a".repeat(500) })).q).toHaveLength(100);
  });
});

describe("applyFilters", () => {
  it("keeps everything with the default filters", () => {
    expect(run({}).sort()).toEqual(ids(MODULES).sort());
  });

  it("searches series and model, every word must match", () => {
    expect(run({ q: "perc" })).toEqual(["fixture-perc-500"]);
    expect(run({ q: "fx-450" })).toEqual(["fixture-topcon-450"]);
    expect(run({ q: "topcon 600" })).toEqual(["fixture-topcon-600"]);
    expect(run({ q: "  FIXTURE   series " })).toEqual(["fixture-series-only"]);
    expect(run({ q: "TEST-FIXTURE" })).toEqual([]);
  });

  it("matches across Turkish case and diacritics", () => {
    const black = { ...NO_POWER, id: "tr-black", series: "BLACK SERİES", model: null };
    const ascii = { ...NO_POWER, id: "tr-ascii", series: "BIFACIAL MODULE", model: null };
    const isik = { ...NO_POWER, id: "tr-isik", series: "Fixture", model: "IŞIK-Çift Cam" };
    const list = [black, ascii, isik];
    for (const q of ["series", "Series", "SERIES", "SERİES", "serıes"]) expect(run({ q }, list), q).toEqual(["tr-black"]);
    for (const q of ["bifacial", "Bifacial", "BİFACİAL", "bıfacıal"]) expect(run({ q }, list), q).toEqual(["tr-ascii"]);
    for (const q of ["isik", "ışık", "IŞIK", "cift cam", "çift"]) expect(run({ q }, list), q).toEqual(["tr-isik"]);
  });

  it("filters by technology", () => {
    expect(run({ technology: ["perc"] })).toEqual(["fixture-perc-500"]);
    expect(run({ technology: ["topcon"], sort: "power", dir: "asc" })).toEqual(["fixture-topcon-450", "fixture-topcon-600"]);
    expect(run({ technology: ["unknown", "perc"] }).sort()).toEqual(["fixture-perc-500", "fixture-series-only"]);
  });

  it("filters by power with range overlap", () => {
    expect(powerRange(SERIES)).toEqual({ min: 500, max: 520 });
    expect(powerRange(record("fixture-perc-500"))).toEqual({ min: 500, max: 500 });
    expect(run({ minW: 510 })).toEqual(["fixture-topcon-600", "fixture-series-only"]);
    expect(run({ maxW: 505 })).toEqual(["fixture-series-only", "fixture-perc-500", "fixture-topcon-450"]);
    expect(run({ minW: 501, maxW: 599 })).toEqual(["fixture-series-only"]);
    // reversed bounds still mean "between"
    expect(run({ minW: 599, maxW: 501 })).toEqual(["fixture-series-only"]);
  });

  it("drops records of unknown power only when a power bound is set", () => {
    const list = [...MODULES, NO_POWER];
    expect(run({}, list)).toContain("fixture-no-power");
    expect(run({ minW: 1 }, list)).not.toContain("fixture-no-power");
    expect(run({ maxW: 10_000 }, list)).not.toContain("fixture-no-power");
  });

  it("filters bifacial yes or no and leaves out records where it is unknown", () => {
    expect(run({ bifacial: "yes" })).toEqual(["fixture-topcon-600"]);
    expect(run({ bifacial: "no" }).sort()).toEqual(["fixture-perc-500", "fixture-topcon-450"]);
    expect(run({ bifacial: "any" })).toHaveLength(4);
  });

  it("filters by frame colour, ignoring case", () => {
    expect(run({ frame: ["black"] })).toEqual(["fixture-topcon-450"]);
    expect(run({ frame: ["Silver"] })).toEqual(["fixture-topcon-600", "fixture-perc-500"]);
    expect(run({ frame: ["silver", "black"] })).toHaveLength(3);
  });

  it("combines filters", () => {
    expect(run({ technology: ["topcon"], frame: ["silver"], minW: 500 })).toEqual(["fixture-topcon-600"]);
    expect(run({ technology: ["perc"], bifacial: "yes" })).toEqual([]);
  });

  it("sorts by power (rated or top of range) with unknown power last both ways", () => {
    const list = [NO_POWER, ...MODULES];
    expect(run({ sort: "power", dir: "desc" }, list)).toEqual([
      "fixture-topcon-600",
      "fixture-series-only",
      "fixture-perc-500",
      "fixture-topcon-450",
      "fixture-no-power",
    ]);
    expect(run({ sort: "power", dir: "asc" }, list)).toEqual([
      "fixture-topcon-450",
      "fixture-perc-500",
      "fixture-series-only",
      "fixture-topcon-600",
      "fixture-no-power",
    ]);
  });

  it("sorts by efficiency, falling back to the series maximum, ties broken by id", () => {
    const list = [NO_POWER, ...MODULES];
    expect(run({ sort: "efficiency", dir: "desc" }, list)).toEqual([
      "fixture-topcon-450",
      "fixture-topcon-600",
      "fixture-series-only",
      "fixture-perc-500",
      "fixture-no-power",
    ]);
    expect(run({ sort: "efficiency", dir: "asc" }, list)).toEqual([
      "fixture-perc-500",
      "fixture-series-only",
      "fixture-topcon-450",
      "fixture-topcon-600",
      "fixture-no-power",
    ]);
  });

  it("sorts by module area with unknown sizes last", () => {
    expect(run({ sort: "size", dir: "desc" })).toEqual(["fixture-topcon-600", "fixture-perc-500", "fixture-topcon-450", "fixture-series-only"]);
    expect(run({ sort: "size", dir: "asc" })).toEqual(["fixture-topcon-450", "fixture-perc-500", "fixture-topcon-600", "fixture-series-only"]);
  });

  it("does not reorder the input array", () => {
    const input = [...MODULES];
    applyFilters(input, filters({ sort: "size", dir: "asc" }));
    expect(ids(input)).toEqual(ids(MODULES));
  });
});

describe("frameColours", () => {
  it("lists distinct colours once, sorted, ignoring case and nulls", () => {
    expect(frameColours(MODULES)).toEqual(["black", "silver"]);
    const extra = { ...record("fixture-perc-500"), id: "x", frame_color: " Silver " };
    expect(frameColours([...MODULES, extra])).toEqual(["black", "silver"]);
    expect(frameColours([SERIES])).toEqual([]);
  });
});
