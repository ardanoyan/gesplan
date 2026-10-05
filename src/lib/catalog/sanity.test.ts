import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import fixtureJson from "../../../e2e/fixtures/catalog-fixture.json";
import { catalogProblems, nullFields, sanityProblems } from "./sanity";
import { catalogFileSchema, type ModuleRecord } from "./schema";

// Fake test data (brand TEST-FIXTURE); fixture-topcon-600 is sane, so each case breaks one rule.
const FIXTURE = catalogFileSchema.parse(fixtureJson);
const record = (id: string) => {
  const m = FIXTURE.modules.find((r) => r.id === id);
  if (!m) throw new Error(`fixture has no ${id}`);
  return m;
};
const BASE = record("fixture-topcon-600");
const SERIES = record("fixture-series-only");
const problems = (patch: Partial<ModuleRecord>, base: ModuleRecord = BASE) => sanityProblems({ ...base, ...patch });

describe("sanityProblems", () => {
  it("finds nothing wrong with the fixture records", () => {
    for (const m of FIXTURE.modules) expect(sanityProblems(m), m.id).toEqual([]);
  });

  it.each(["efficiency_pct", "efficiency_max_pct"] as const)("keeps %s strictly between 0 and 30", (key) => {
    expect(problems({ [key]: 22.7 })).toEqual([]);
    expect(problems({ [key]: 29.9 })).toEqual([]);
    expect(problems({ [key]: 30 })).toEqual([`${key} 0 ile 30 arasında olmalı (30)`]);
    expect(problems({ [key]: 227 })).toHaveLength(1);
    expect(problems({ [key]: null })).toEqual([]);
  });

  it("wants Voc above Vmp", () => {
    expect(problems({ v_oc: 48, v_mp: 40 })).toEqual([]);
    expect(problems({ v_oc: 40, v_mp: 48 })).toEqual(["v_oc (40) v_mp (48) değerinden büyük olmalı"]);
    expect(problems({ v_oc: 40, v_mp: 40 })).toHaveLength(1);
    expect(problems({ v_oc: null, v_mp: 40 })).toEqual([]);
  });

  it("wants Isc above Imp", () => {
    expect(problems({ i_sc: 16, i_mp: 15 })).toEqual([]);
    expect(problems({ i_sc: 15, i_mp: 16 })).toEqual(["i_sc (15) i_mp (16) değerinden büyük olmalı"]);
    expect(problems({ i_sc: 16, i_mp: null })).toEqual([]);
  });

  it("wants the length to be the long side", () => {
    expect(problems({ length_mm: 2400, width_mm: 1100 })).toEqual([]);
    expect(problems({ length_mm: 1100, width_mm: 2400 })).toHaveLength(1);
    expect(problems({ length_mm: 1100, width_mm: 1100 })).toHaveLength(1);
    expect(problems({ length_mm: null, width_mm: 1100 })).toEqual([]);
  });

  it("wants an ordered power range", () => {
    expect(problems({}, SERIES)).toEqual([]);
    expect(problems({ p_max_range_w: { min: 510, max: 510 } }, SERIES)).toEqual([]);
    expect(problems({ p_max_range_w: { min: 520, max: 500 } }, SERIES)).toEqual([
      "p_max_range_w alt sınırı (520) üst sınırdan (500) büyük",
    ]);
  });

  it("wants the rated power inside the published range when both are set", () => {
    expect(problems({ p_max_w: 600, p_max_range_w: { min: 580, max: 620 } })).toEqual([]);
    expect(problems({ p_max_w: 600, p_max_range_w: { min: 600, max: 600 } })).toEqual([]);
    expect(problems({ p_max_w: 600, p_max_range_w: { min: 500, max: 520 } })).toEqual([
      "p_max_w (600) p_max_range_w aralığının (500-520) dışında",
    ]);
  });

  it("keeps bifaciality a percentage", () => {
    expect(problems({ bifaciality: 80 })).toEqual([]);
    expect(problems({ bifaciality: 100 })).toEqual([]);
    expect(problems({ bifaciality: 101 })).toHaveLength(1);
    expect(problems({ bifaciality: null })).toEqual([]);
  });

  it("wants falling power and voltage and rising current with temperature", () => {
    expect(problems({ gamma_pmax_pct_per_c: -0.3, beta_voc_pct_per_c: -0.25, alpha_isc_pct_per_c: 0.05 })).toEqual([]);
    expect(problems({ gamma_pmax_pct_per_c: 0.3 })).toEqual(["gamma_pmax_pct_per_c negatif olmalı (0.3)"]);
    expect(problems({ gamma_pmax_pct_per_c: 0 })).toHaveLength(1);
    expect(problems({ beta_voc_pct_per_c: 0.25 })).toEqual(["beta_voc_pct_per_c negatif olmalı (0.25)"]);
    expect(problems({ alpha_isc_pct_per_c: -0.05 })).toEqual(["alpha_isc_pct_per_c pozitif olmalı (-0.05)"]);
    expect(problems({ alpha_isc_pct_per_c: 0 })).toHaveLength(1);
    expect(problems({ gamma_pmax_pct_per_c: null, beta_voc_pct_per_c: null, alpha_isc_pct_per_c: null })).toEqual([]);
  });

  it.each(["warranty_product_years", "warranty_performance_years"] as const)("keeps %s between 1 and 50", (key) => {
    expect(problems({ [key]: 1 })).toEqual([]);
    expect(problems({ [key]: 50 })).toEqual([]);
    expect(problems({ [key]: 0.5 })).toEqual([`${key} 1 ile 50 yıl arasında olmalı (0.5)`]);
    expect(problems({ [key]: 51 })).toHaveLength(1);
    expect(problems({ [key]: null })).toEqual([]);
  });

  it("refuses a rated power on a series record", () => {
    expect(problems({ p_max_w: null }, SERIES)).toEqual([]);
    expect(problems({ p_max_w: 510 }, SERIES)).toEqual(["series kaydında p_max_w boş olmalı (510)"]);
    expect(problems({ record_level: "variant", p_max_w: 510 }, SERIES)).toEqual([]);
  });
});

describe("nullFields", () => {
  it("lists the null fields in key order", () => {
    expect(nullFields(BASE)).toEqual([
      "cell_count",
      "bifaciality",
      "p_max_range_w",
      "efficiency_max_pct",
      "degradation_year1_pct",
      "degradation_yearly_pct",
      "datasheet_url",
    ]);
    expect(nullFields(SERIES)).toContain("length_mm");
    expect(nullFields(SERIES)).not.toContain("p_max_range_w");
  });

  it("is empty for a record with every value", () => {
    const full: ModuleRecord = {
      ...BASE,
      cell_count: 132,
      bifaciality: 80,
      p_max_range_w: { min: 580, max: 620 },
      efficiency_max_pct: 23,
      degradation_year1_pct: 1,
      degradation_yearly_pct: 0.4,
      datasheet_url: "https://example.invalid/fixture.pdf",
    };
    expect(nullFields(full)).toEqual([]);
  });
});

describe("catalogProblems", () => {
  it("is empty for the fixture", () => {
    expect(catalogProblems(FIXTURE)).toEqual([]);
  });

  it("prefixes each problem with the record id and reports a duplicate id once", () => {
    const broken = { ...record("fixture-perc-500"), v_oc: 30 };
    const file = { catalog_version: "t", modules: [...FIXTURE.modules, BASE, BASE, broken] };
    expect(catalogProblems(file)).toEqual([
      "fixture-topcon-600: id birden fazla kayıtta kullanılmış",
      "fixture-perc-500: id birden fazla kayıtta kullanılmış",
      "fixture-perc-500: v_oc (30) v_mp (38) değerinden büyük olmalı",
    ]);
  });
});

// The script runs on Node's type stripping, so this also catches a value import (or an "@/"
// alias) creeping into schema.ts or sanity.ts.
describe("scripts/catalog-validate.ts", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const validate = (file: string) =>
    spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/catalog-validate.ts", file], {
      cwd: root,
      encoding: "utf8",
    });

  it("passes the fixture and lists each record with its null fields", () => {
    const run = validate("e2e/fixtures/catalog-fixture.json");
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("- fixture-series-only  series  verified=false");
    expect(run.stdout).toContain("Yerleşimde kullanılabilir (boy, en ve güç dolu): 3/4");
  });

  it("fails on sanity and schema errors but not on nulls", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gesplan-validate-"));
    try {
      const swapped = path.join(dir, "swapped.json");
      writeFileSync(swapped, JSON.stringify({ ...FIXTURE, modules: [{ ...BASE, v_oc: 30 }] }));
      const bad = validate(swapped);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("fixture-topcon-600: v_oc (30) v_mp (40) değerinden büyük olmalı");

      const offSchema = path.join(dir, "off-schema.json");
      writeFileSync(offSchema, JSON.stringify({ ...FIXTURE, modules: [{ ...BASE, p_max_w: "600" }] }));
      const off = validate(offSchema);
      expect(off.status).toBe(1);
      expect(off.stderr).toContain("modules.0.p_max_w");

      const nulls = path.join(dir, "nulls.json");
      writeFileSync(nulls, JSON.stringify({ ...FIXTURE, modules: [{ ...BASE, v_oc: null, length_mm: null }] }));
      expect(validate(nulls).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
