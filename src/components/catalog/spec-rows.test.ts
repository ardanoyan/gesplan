import { describe, expect, it } from "vitest";
import fixture from "../../../e2e/fixtures/catalog-fixture.json";
import { catalogFileSchema, moduleRecordSchema, type ModuleRecord } from "@/lib/catalog/schema";
import {
  NO_DATA,
  SPEC_FIELDS_SHOWN_ELSEWHERE,
  bifacialLabel,
  compareRows,
  countLabel,
  dimensionsLabel,
  efficiencyLabel,
  fetchedAtLabel,
  frameColourLabel,
  num,
  powerLabel,
  specGroups,
  technologyLabel,
  unusableReason,
} from "./spec-rows";

// Fake TEST-FIXTURE records only; never Kıvanç data.
const modules = catalogFileSchema.parse(fixture).modules;
const byId = (id: string): ModuleRecord => {
  const m = modules.find((r) => r.id === id);
  if (!m) throw new Error(`fixture record ${id} missing`);
  return m;
};
const variant = byId("fixture-topcon-600");
const series = byId("fixture-series-only");

describe("num", () => {
  it("shows only the decimals a value needs, in tr-TR format", () => {
    expect(num(600)).toBe("600");
    expect(num(22.7)).toBe("22,7");
    expect(num(23.42)).toBe("23,42");
    expect(num(2278)).toBe("2.278");
    expect(num(-0.3, 3)).toBe("-0,3");
  });
});

describe("powerLabel", () => {
  it("prints rated power for a variant", () => {
    expect(powerLabel(variant)).toBe("600 W");
  });
  it("prints the published range for a series record", () => {
    expect(powerLabel(series)).toBe("500-520 W");
    expect(powerLabel({ ...series, p_max_range_w: { min: 570, max: 605 } })).toBe("570-605 W");
  });
  it("keeps decimals and says when nothing is known", () => {
    expect(powerLabel({ ...variant, p_max_w: 432.5 })).toBe("432,5 W");
    expect(powerLabel({ ...series, p_max_range_w: null })).toBe(NO_DATA);
  });
});

describe("efficiencyLabel", () => {
  it("puts the percent sign first, as Turkish does", () => {
    expect(efficiencyLabel(variant)).toBe("%22,7");
  });
  it("marks a series value as a maximum", () => {
    expect(efficiencyLabel({ ...series, efficiency_max_pct: 23.42 })).toBe("en fazla %23,42");
  });
  it("falls back to Veri yok", () => {
    expect(efficiencyLabel({ ...series, efficiency_max_pct: null })).toBe(NO_DATA);
  });
});

describe("dimensions, technology, bifacial and frame labels", () => {
  it("formats length by width in mm or says the size is missing", () => {
    expect(dimensionsLabel(variant)).toBe("2.400 × 1.100 mm");
    expect(dimensionsLabel(series)).toBe("Boyut verisi yok");
    expect(dimensionsLabel({ ...variant, width_mm: null })).toBe("Boyut verisi yok");
  });
  it("names technologies", () => {
    expect(technologyLabel("topcon")).toBe("TOPCon");
    expect(technologyLabel("perc")).toBe("PERC");
    expect(technologyLabel("unknown")).toBe("Teknoloji belirtilmemiş");
  });
  it("gives no bifacial label when the document does not say", () => {
    expect(bifacialLabel(true)).toBe("Çift yüzlü");
    expect(bifacialLabel(false)).toBe("Tek yüzlü");
    expect(bifacialLabel(null)).toBeNull();
  });
  it("translates common frame colours and keeps others as published", () => {
    expect(frameColourLabel("black")).toBe("Siyah");
    expect(frameColourLabel("Silver")).toBe("Gümüş");
    expect(frameColourLabel("anodised bronze")).toBe("anodised bronze");
  });
});

describe("unusableReason", () => {
  it("is null for a record with size and power", () => {
    expect(unusableReason(variant)).toBeNull();
  });
  it("uses the agreed wording when both are missing", () => {
    expect(unusableReason(series)).toBe("Boyut ve güç verisi yok; yerleşim hesaplanamaz.");
  });
  it("names the one missing part otherwise", () => {
    expect(unusableReason({ ...variant, length_mm: null })).toBe("Boyut verisi yok; yerleşim hesaplanamaz.");
    expect(unusableReason({ ...variant, p_max_w: null })).toBe("Güç verisi yok; yerleşim hesaplanamaz.");
  });
});

describe("fetchedAtLabel and countLabel", () => {
  it("formats the fetch date in Turkish on the Istanbul calendar day", () => {
    expect(fetchedAtLabel("2026-10-01T00:00:00Z")).toBe("1 Ekim 2026");
    // 22:30 UTC is already the next day in Istanbul (UTC+3).
    expect(fetchedAtLabel("2026-09-30T22:30:00Z")).toBe("1 Ekim 2026");
  });
  it("counts results or explains an empty list", () => {
    expect(countLabel(6, 6)).toBe("6 panel");
    expect(countLabel(1200, 1200)).toBe("1.200 panel");
    expect(countLabel(0, 6)).toBe("Filtreye uyan panel yok");
    expect(countLabel(0, 0)).toBe("Katalogda panel yok");
  });
});

describe("specGroups", () => {
  it("covers every schema field, apart from the links and notes shown separately", () => {
    const covered = new Set<string>(specGroups(variant).flatMap((g) => g.rows.map((r) => r.key)));
    for (const f of SPEC_FIELDS_SHOWN_ELSEWHERE) covered.add(f);
    expect([...covered].sort()).toEqual(Object.keys(moduleRecordSchema.shape).sort());
  });
  it("shows Veri yok for nulls and never a guessed value", () => {
    const rows = specGroups(series).flatMap((g) => g.rows);
    const value = (key: keyof ModuleRecord) => rows.find((r) => r.key === key);
    expect(value("p_max_w")).toMatchObject({ value: NO_DATA, missing: true });
    expect(value("length_mm")).toMatchObject({ value: NO_DATA, missing: true });
    expect(value("bifacial")).toMatchObject({ value: NO_DATA, missing: true });
    expect(value("p_max_range_w")).toMatchObject({ value: "500-520 W", missing: false });
  });
  it("adds Turkish units", () => {
    const rows = specGroups(variant).flatMap((g) => g.rows);
    const value = (key: keyof ModuleRecord) => rows.find((r) => r.key === key)?.value;
    expect(value("v_mp")).toBe("40 V");
    expect(value("i_mp")).toBe("15 A");
    expect(value("i_sc")).toBe("16 A");
    expect(value("max_system_voltage_v")).toBe("1.500 V");
    expect(value("gamma_pmax_pct_per_c")).toBe("-0,3 %/°C");
    expect(value("noct_c")).toBe("45 °C");
    expect(value("length_mm")).toBe("2.400 mm");
    expect(value("weight_kg")).toBe("25 kg");
    expect(value("warranty_performance_years")).toBe("30 yıl");
    expect(value("bifacial")).toBe("Evet");
    expect(value("record_level")).toBe("Model");
    expect(value("verified")).toBe("Doğrulanmadı");
    expect(value("fetched_at")).toBe("1 Ekim 2026");
    expect(value("frame_color")).toBe("Gümüş");
  });
});

describe("compareRows", () => {
  it("gives one value per candidate in order", () => {
    const rows = compareRows([variant, series]);
    for (const r of rows) expect(r.values).toHaveLength(2);
    const row = (label: string) => rows.find((r) => r.label === label)?.values;
    expect(row("Güç")).toEqual(["600 W", "500-520 W"]);
    expect(row("Verim")).toEqual(["%22,7", "en fazla %21,5"]);
    expect(row("Boyut")).toEqual(["2.400 × 1.100 mm", "Boyut verisi yok"]);
    expect(row("Çift yüzlü")).toEqual(["Çift yüzlü", NO_DATA]);
    expect(row("Tasarımda kullanım")).toEqual(["Kullanılabilir", "Boyut ve güç verisi yok; yerleşim hesaplanamaz."]);
  });
});
