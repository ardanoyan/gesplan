import { describe, expect, it } from "vitest";
import fixtureJson from "../../../e2e/fixtures/catalog-fixture.json";
import { layoutFace, type FaceSpec } from "@/lib/geo/layout";
import type { XY } from "@/lib/geo/types";
import { compareOnDesign, type DesignSnapshot } from "./compare";
import { catalogFileSchema } from "./schema";

// Fake test data (brand TEST-FIXTURE), never Kıvanç data.
const MODULES = catalogFileSchema.parse(fixtureJson).modules;

const rect = (w: number, h: number, x0 = 0, y0 = 0): XY[] => [
  [x0, y0],
  [x0 + w, y0],
  [x0 + w, y0 + h],
  [x0, y0 + h],
];
const PITCHED: FaceSpec = {
  kind: "pitched",
  tiltDeg: 30,
  azimuthDeg: 180,
  setbackM: 0.5,
  orientation: "portrait",
  rackTiltDeg: 10,
  rowsPerTable: 1,
  limitElevationDeg: 20,
};
const FLAT: FaceSpec = { ...PITCHED, kind: "flat", tiltDeg: 0, rackTiltDeg: 15, rowsPerTable: 2, orientation: "landscape" };

// Two 20 x 12 m roofs side by side: one pitched, one flat with a chimney.
const DESIGN: DesignSnapshot = {
  faces: [
    { id: "a", name: "Çatı 1", footprint: rect(20, 12), face: PITCHED },
    { id: "b", name: "Çatı 2", footprint: rect(20, 12, 30, 0), face: FLAT },
  ],
  obstacles: [{ footprint: rect(1, 1, 40, 6), clearanceM: 0.3 }],
  gapM: 0.02,
};

describe("compareOnDesign", () => {
  const results = compareOnDesign(MODULES, DESIGN);

  it("returns one result per candidate in order", () => {
    expect(results.map((r) => r.id)).toEqual(MODULES.map((m) => m.id));
  });

  it("packs each usable candidate exactly as a direct layoutFace call with its dimensions", () => {
    for (const m of MODULES) {
      if (m.length_mm === null || m.width_mm === null || m.p_max_w === null) continue;
      const spec = { wp: m.p_max_w, lengthM: m.length_mm / 1000, widthM: m.width_mm / 1000, gapM: DESIGN.gapM };
      const direct = DESIGN.faces.map((f) => layoutFace(f.footprint, f.face, DESIGN.obstacles, spec).count);
      const r = results.find((x) => x.id === m.id);
      if (!r || !r.usable) throw new Error(`${m.id} should be usable`);
      expect(r.perFace.map((f) => f.count), m.id).toEqual(direct);
      expect(r.perFace.map((f) => f.name)).toEqual(["Çatı 1", "Çatı 2"]);
      expect(r.count).toBe(direct[0] + direct[1]);
      expect(r.count).toBeGreaterThan(0);
      expect(r.kwp).toBeCloseTo((r.count * m.p_max_w) / 1000, 9);
      for (const f of r.perFace) expect(f.kwp).toBeCloseTo((f.count * m.p_max_w) / 1000, 9);
    }
  });

  it("gives different counts for different module sizes", () => {
    const counts = results.flatMap((r) => (r.usable ? [r.count] : []));
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it("marks a record without dimensions or power as unusable", () => {
    expect(results.find((r) => r.id === "fixture-series-only")).toEqual({ id: "fixture-series-only", usable: false });
  });

  it("counts nothing on a design without faces", () => {
    const [first] = compareOnDesign(MODULES.slice(0, 1), { ...DESIGN, faces: [] });
    expect(first).toEqual({ id: "fixture-topcon-600", usable: true, count: 0, kwp: 0, perFace: [] });
  });
});
