import { describe, expect, it } from "vitest";
import fixtureJson from "../../../e2e/fixtures/catalog-fixture.json";
import { catalogFileSchema, catalogResponseSchema, moduleRecordSchema, moduleResponseSchema } from "./schema";

// The fixture is fake test data (brand TEST-FIXTURE), never Kıvanç data.
const FIXTURE = catalogFileSchema.parse(fixtureJson);
const record = (id: string) => {
  const m = FIXTURE.modules.find((r) => r.id === id);
  if (!m) throw new Error(`fixture has no ${id}`);
  return m;
};

describe("moduleRecordSchema", () => {
  it("accepts every fixture record", () => {
    expect(FIXTURE.catalog_version).toBe("fixture-2026-10-01");
    expect(FIXTURE.modules.map((m) => m.id)).toEqual([
      "fixture-topcon-600",
      "fixture-topcon-450",
      "fixture-perc-500",
      "fixture-series-only",
    ]);
  });

  it("allows nulls for everything a datasheet cover does not print", () => {
    const series = record("fixture-series-only");
    expect(series.record_level).toBe("series");
    expect(series.p_max_w).toBeNull();
    expect(series.length_mm).toBeNull();
    expect(series.p_max_range_w).toEqual({ min: 500, max: 520 });
    expect(moduleRecordSchema.safeParse(series).success).toBe(true);
  });

  it.each([
    ["power as a string", { p_max_w: "600" }],
    ["a negative length", { length_mm: -2400 }],
    ["zero width", { width_mm: 0 }],
    ["an unknown record level", { record_level: "panel" }],
    ["an unknown technology", { technology: "hjt" }],
    ["a fractional cell count", { cell_count: 60.5 }],
    ["an infinite value", { v_oc: Number.POSITIVE_INFINITY }],
    ["a free-text date", { fetched_at: "1 Ekim 2026" }],
    ["a relative source URL", { source_url: "/urunler/solar-paneller" }],
    ["verified as a string", { verified: "false" }],
    ["notes as a string", { notes: "fake" }],
    ["an empty id", { id: "" }],
    ["a range with a zero bound", { p_max_range_w: { min: 0, max: 520 } }],
  ])("rejects %s", (_label, patch) => {
    expect(moduleRecordSchema.safeParse({ ...record("fixture-topcon-600"), ...patch }).success).toBe(false);
  });

  it("rejects a record with a field missing instead of null", () => {
    const rest: Record<string, unknown> = { ...record("fixture-topcon-600") };
    delete rest.efficiency_pct;
    expect(moduleRecordSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts negative temperature coefficients", () => {
    const m = { ...record("fixture-topcon-600"), gamma_pmax_pct_per_c: -0.29, beta_voc_pct_per_c: -0.25 };
    expect(moduleRecordSchema.safeParse(m).success).toBe(true);
  });
});

describe("response envelopes", () => {
  it("needs a known source on the list response", () => {
    expect(catalogResponseSchema.safeParse({ ...FIXTURE, source: "static" }).success).toBe(true);
    expect(catalogResponseSchema.safeParse({ ...FIXTURE, source: "http" }).success).toBe(true);
    expect(catalogResponseSchema.safeParse({ ...FIXTURE, source: "ftp" }).success).toBe(false);
    expect(catalogResponseSchema.safeParse(FIXTURE).success).toBe(false);
  });

  it("wraps one record as { module }", () => {
    expect(moduleResponseSchema.safeParse({ module: record("fixture-perc-500") }).success).toBe(true);
    expect(moduleResponseSchema.safeParse(record("fixture-perc-500")).success).toBe(false);
  });

  it("rejects a file without a catalogue version", () => {
    expect(catalogFileSchema.safeParse({ modules: FIXTURE.modules }).success).toBe(false);
    expect(catalogFileSchema.safeParse({ catalog_version: "", modules: [] }).success).toBe(false);
  });
});
