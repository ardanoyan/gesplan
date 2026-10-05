import { describe, expect, it } from "vitest";
import fixtureJson from "../../../e2e/fixtures/catalog-fixture.json";
import { catalogFileSchema, type ModuleRecord } from "./schema";
import { PLACEHOLDER_MODULE, isUsable, moduleLabel, moduleSpec, pickDefaultModule, resolveModule, toActiveModule } from "./select";

// Fake test data (brand TEST-FIXTURE), never Kıvanç data.
const MODULES = catalogFileSchema.parse(fixtureJson).modules;
const record = (id: string) => {
  const m = MODULES.find((r) => r.id === id);
  if (!m) throw new Error(`fixture has no ${id}`);
  return m;
};
const T600 = record("fixture-topcon-600");
const T450 = record("fixture-topcon-450");
const P500 = record("fixture-perc-500");
const SERIES = record("fixture-series-only");

describe("isUsable", () => {
  it("needs length, width and rated power", () => {
    expect(MODULES.filter(isUsable).map((m) => m.id)).toEqual(["fixture-topcon-600", "fixture-topcon-450", "fixture-perc-500"]);
    expect(isUsable({ ...T600, length_mm: null })).toBe(false);
    expect(isUsable({ ...T600, width_mm: null })).toBe(false);
    expect(isUsable({ ...T600, p_max_w: null })).toBe(false);
  });
});

describe("toActiveModule", () => {
  it("converts millimetres to metres and keeps the versioned ref", () => {
    if (!isUsable(T600)) throw new Error("fixture-topcon-600 should be usable");
    const a = toActiveModule(T600);
    expect(a).toMatchObject({ ref: { id: "fixture-topcon-600", version: "fixture-1" }, label: "Fixture TOPCon FX-600T", wp: 600 });
    expect(a.lengthM).toBeCloseTo(2.4);
    expect(a.widthM).toBeCloseTo(1.1);
    expect(a.placeholder).toBe(false);
    expect(moduleSpec(a, 0.02)).toEqual({ wp: 600, lengthM: 2.4, widthM: 1.1, gapM: 0.02 });
  });

  it("labels by series and model, or by id when both are missing", () => {
    expect(moduleLabel(SERIES)).toBe("Fixture Series");
    expect(moduleLabel({ ...SERIES, series: null })).toBe("fixture-series-only");
  });
});

describe("pickDefaultModule", () => {
  it("takes the env id when it names a usable record", () => {
    expect(pickDefaultModule(MODULES, "fixture-perc-500").ref.id).toBe("fixture-perc-500");
  });

  it("ignores an unknown or unusable env id", () => {
    expect(pickDefaultModule(MODULES, "no-such-id").ref.id).toBe("fixture-topcon-600");
    expect(pickDefaultModule(MODULES, "fixture-series-only").ref.id).toBe("fixture-topcon-600");
    expect(pickDefaultModule(MODULES, "").ref.id).toBe("fixture-topcon-600");
    expect(pickDefaultModule(MODULES, null).ref.id).toBe("fixture-topcon-600");
  });

  it("prefers the most powerful TOPCon even over a more powerful PERC", () => {
    const bigPerc: ModuleRecord = { ...P500, id: "fixture-perc-700", p_max_w: 700 };
    expect(pickDefaultModule([T450, bigPerc, T600]).ref.id).toBe("fixture-topcon-600");
  });

  it("falls back to the most powerful usable record of any technology", () => {
    const perc450: ModuleRecord = { ...P500, id: "fixture-perc-450", p_max_w: 450 };
    expect(pickDefaultModule([perc450, P500, SERIES]).ref.id).toBe("fixture-perc-500");
  });

  it("keeps the placeholder when nothing is usable", () => {
    expect(pickDefaultModule([SERIES])).toBe(PLACEHOLDER_MODULE);
    expect(pickDefaultModule([])).toBe(PLACEHOLDER_MODULE);
    expect(PLACEHOLDER_MODULE).toMatchObject({ label: "Yer tutucu modül", placeholder: true, record: null });
  });
});

describe("resolveModule", () => {
  it("restores the saved module when it is still usable", () => {
    expect(resolveModule({ id: "fixture-topcon-450", version: "fixture-1" }, MODULES).ref.id).toBe("fixture-topcon-450");
  });

  it("uses the record's current values and version when the saved version is stale", () => {
    const a = resolveModule({ id: "fixture-topcon-450", version: "fixture-0" }, MODULES);
    expect(a.ref).toEqual({ id: "fixture-topcon-450", version: "fixture-1" });
  });

  it("falls back to the default when the saved module is gone or unusable", () => {
    expect(resolveModule({ id: "removed-module", version: "3" }, MODULES).ref.id).toBe("fixture-topcon-600");
    expect(resolveModule({ id: "fixture-series-only", version: "fixture-1" }, MODULES).ref.id).toBe("fixture-topcon-600");
    expect(resolveModule({ id: "removed-module", version: "3" }, MODULES, "fixture-perc-500").ref.id).toBe("fixture-perc-500");
    expect(resolveModule(null, MODULES).ref.id).toBe("fixture-topcon-600");
  });

  it("keeps the placeholder while the catalogue has nothing usable", () => {
    expect(resolveModule(PLACEHOLDER_MODULE.ref, [SERIES])).toBe(PLACEHOLDER_MODULE);
    expect(resolveModule({ id: "removed-module", version: "3" }, [SERIES])).toBe(PLACEHOLDER_MODULE);
    expect(resolveModule(null, [])).toBe(PLACEHOLDER_MODULE);
  });

  it("moves a placeholder design to the default once a usable record exists", () => {
    expect(resolveModule(PLACEHOLDER_MODULE.ref, MODULES).ref.id).toBe("fixture-topcon-600");
  });
});
