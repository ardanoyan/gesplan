import { describe, expect, it } from "vitest";
import { localFrame } from "./frame";
import { rackPitch, layoutFace, suggestAzimuth, type FaceSpec, type ModuleSpec } from "./layout";
import { isSimpleRing, pointInRing, segmentDistance } from "./polygon";
import type { XY } from "./types";

const MODULE: ModuleSpec = { wp: 590, lengthM: 2.278, widthM: 1.134, gapM: 0.02 };
const BASE: FaceSpec = {
  kind: "pitched",
  tiltDeg: 0,
  azimuthDeg: 180,
  setbackM: 0.5,
  orientation: "portrait",
  rackTiltDeg: 10,
  rowsPerTable: 1,
  limitElevationDeg: 20,
};
const rect = (w: number, h: number, x0 = 0, y0 = 0): XY[] => [
  [x0, y0],
  [x0 + w, y0],
  [x0 + w, y0 + h],
  [x0, y0 + h],
];
/** Rotate counter-clockwise about the origin. */
const rotate = (ring: XY[], deg: number): XY[] => {
  const a = (deg * Math.PI) / 180;
  return ring.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as XY);
};
/** Z-order clicks on a 20 x 10 m rectangle: the edges cross in the middle. */
const BOW_TIE: XY[] = [
  [0, 0],
  [20, 0],
  [0, 10],
  [20, 10],
];

// The seeded randomised checks pack 25 polygons each; alone they take about 2 s, but under a
// loaded full-suite run they can pass Vitest's 5 s default, which would be a timeout, not a bug.
const RANDOMISED_TIMEOUT_MS = 30_000;

/** Deterministic PRNG so the randomised checks are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPolygon(rand: () => number): XY[] {
  const n = 5 + Math.floor(rand() * 6);
  const cx = 0;
  const cy = 0;
  const pts: XY[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const r = 12 + rand() * 18;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Separating-axis test for two convex quads; true if interiors overlap. */
function quadsOverlap(a: XY[], b: XY[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = q[1] - p[1];
      const ny = p[0] - q[0];
      const pa = a.map(([x, y]) => x * nx + y * ny);
      const pb = b.map(([x, y]) => x * nx + y * ny);
      const len = Math.hypot(nx, ny);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-6 * len || Math.max(...pb) <= Math.min(...pa) + 1e-6 * len) return false;
    }
  }
  return true;
}

describe("rackPitch", () => {
  it("matches the hand-computed pitch for a 10 degree rack and a 20 degree limit angle", () => {
    // 2.278 cos10 + 2.278 sin10 / tan20 = 2.2434 + 1.0868
    expect(rackPitch(2.278, 10, 20)).toBeCloseTo(3.3302, 3);
  });
  it("is the collector length for a flat-laid module", () => {
    expect(rackPitch(2.278, 0, 20)).toBe(2.278);
  });
});

describe("layoutFace", () => {
  it("fits 16 x 3 portrait modules on a 20 x 10 m flat face with 0.5 m setback", () => {
    // usable 19 x 9 m: floor(19.02 / 1.154) = 16 columns, floor(9.02 / 2.298) = 3 rows
    expect(layoutFace(rect(20, 10), BASE, [], MODULE).count).toBe(48);
  });

  it("gains a row on a 30 degree pitched face because the surface is longer than the footprint", () => {
    const res = layoutFace(rect(20, 10), { ...BASE, tiltDeg: 30 }, [], MODULE);
    // surface depth 10 / cos30 = 11.547 m, usable 10.547 m: 4 rows
    expect(res.count).toBe(64);
    expect(res.surfaceAreaM2).toBeCloseTo(200 / Math.cos(Math.PI / 6), 6);
    // a module's footprint depth along the slope is 2.278 cos30
    const m = res.modules[0];
    const depth = Math.hypot(m[3][0] - m[0][0], m[3][1] - m[0][1]);
    expect(depth).toBeCloseTo(2.278 * Math.cos(Math.PI / 6), 6);
  });

  it("spaces racks on a flat roof at the limit-angle pitch", () => {
    const res = layoutFace(rect(30, 20), { ...BASE, kind: "flat" }, [], MODULE);
    expect(res.pitchM).toBeCloseTo(3.3302, 3);
    expect(res.gcr).toBeCloseTo(2.278 / 3.3302, 3);
    // 25 columns x 6 rows: (6 - 1) x 3.3302 + 2.278 cos10 = 18.89 m fits in 19 m
    expect(res.count).toBe(150);
  });

  it("keeps every module clear of an obstacle by its clearance", () => {
    const obstacle = rect(2, 2, 9, 4);
    const res = layoutFace(rect(20, 10), BASE, [{ footprint: obstacle, clearanceM: 0.5 }], MODULE);
    expect(res.count).toBeLessThan(48);
    expect(res.removedByObstacles).toBeGreaterThan(0);
    for (const m of res.modules) {
      for (let i = 0; i < 4; i++) {
        for (let k = 0; k < 4; k++) {
          const d = segmentDistance(m[i], m[(i + 1) % 4], obstacle[k], obstacle[(k + 1) % 4]);
          expect(d).toBeGreaterThanOrEqual(0.5 - 1e-6);
        }
      }
      for (const p of obstacle) expect(pointInRing(p, m)).toBe(false);
    }
  });

  it("counts blocked positions when an obstacle covers the whole face", () => {
    const cover = rect(22, 12, -1, -1);
    const res = layoutFace(rect(20, 10), BASE, [{ footprint: cover, clearanceM: 0.5 }], MODULE);
    expect(res.count).toBe(0);
    expect(res.removedByObstacles).toBeGreaterThan(0);
  });

  it("refuses a self-intersecting face instead of packing its lobes", () => {
    for (const ring of [BOW_TIE, [[0, 0], [30, 0], [0, 10], [20, 10]] as XY[]]) {
      const res = layoutFace(ring, { ...BASE, tiltDeg: 30 }, [], MODULE);
      expect(res.invalidReason).toBe("self-intersecting");
      expect(res.count).toBe(0);
      expect(res.kwp).toBe(0);
      expect(res.modules).toHaveLength(0);
      expect(res.footprintAreaM2).toBe(0);
      expect(res.surfaceAreaM2).toBe(0);
    }
    expect(layoutFace(rect(20, 10), BASE, [], MODULE).invalidReason).toBeNull();
  });

  it("never overlaps modules and keeps them inside the face (randomised, seeded)", () => {
    const rand = mulberry32(42);
    for (let n = 0; n < 25; n++) {
      const poly = randomPolygon(rand);
      const face: FaceSpec = {
        ...BASE,
        kind: rand() < 0.5 ? "pitched" : "flat",
        tiltDeg: rand() * 35,
        azimuthDeg: rand() * 360,
        orientation: rand() < 0.5 ? "portrait" : "landscape",
        rowsPerTable: 1 + Math.floor(rand() * 2),
      };
      const res = layoutFace(poly, face, [], MODULE, { offsetSteps: 3 });
      for (const m of res.modules) for (const p of m) expect(pointInRing(p, poly)).toBe(true);
      for (let i = 0; i < res.modules.length; i++) {
        for (let j = i + 1; j < res.modules.length; j++) {
          expect(quadsOverlap(res.modules[i], res.modules[j])).toBe(false);
        }
      }
    }
  }, RANDOMISED_TIMEOUT_MS);

  it("never gains modules when the setback grows (randomised, seeded)", () => {
    const rand = mulberry32(7);
    for (let n = 0; n < 25; n++) {
      const poly = randomPolygon(rand);
      const face: FaceSpec = { ...BASE, tiltDeg: rand() * 30, azimuthDeg: rand() * 360 };
      const small = layoutFace(poly, { ...face, setbackM: 0.3 }, [], MODULE, { offsetSteps: 4 }).count;
      const large = layoutFace(poly, { ...face, setbackM: 0.9 }, [], MODULE, { offsetSteps: 4 }).count;
      expect(large).toBeLessThanOrEqual(small);
    }
  }, RANDOMISED_TIMEOUT_MS);
});

describe("suggestAzimuth", () => {
  it("points a rectangle with a long south edge to the south", () => {
    expect(suggestAzimuth(rect(20, 10))).toBe(180);
  });
  it("follows the eave of a rotated face", () => {
    const a = (30 * Math.PI) / 180;
    const rot = rect(20, 10).map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as XY);
    // rotating the footprint 30 degrees counter-clockwise turns the south normal to 150 (south-east)
    expect(suggestAzimuth(rot)).toBeCloseTo(150, 1);
  });
  it("treats an eave split by an extra vertex as one edge", () => {
    for (const x of [10, 12]) {
      const split: XY[] = [[0, 0], [x, 0], [20, 0], [20, 10], [0, 10]];
      expect(suggestAzimuth(split)).toBe(180);
      // same ring started at the split vertex, so the eave wraps round the ring's start
      expect(suggestAzimuth([...split.slice(1), split[0]])).toBe(180);
    }
    expect(suggestAzimuth([[0, 0], [9, 0], [18, 0], [14, 5], [4, 5]])).toBe(180);
  });
  it("merges an eave vertex clicked slightly off the line", () => {
    expect(suggestAzimuth([[0, 0], [10, -0.2], [20, 0], [20, 10], [0, 10]])).toBeCloseTo(180, 0);
  });
  it("returns 0 rather than 360 for a face just west of north", () => {
    // long edge on the north side; a tiny counter-clockwise turn puts its normal at 359.97
    expect(suggestAzimuth(rotate([[5, 0], [15, 0], [20, 10], [0, 10]], 0.03))).toBe(0);
  });
});

describe("isSimpleRing", () => {
  it("rejects a bow-tie", () => {
    expect(isSimpleRing(BOW_TIE)).toBe(false);
  });
  it("accepts a rectangle, a triangle and a rectangle with an extra vertex on an edge", () => {
    expect(isSimpleRing(rect(20, 10))).toBe(true);
    expect(isSimpleRing([[0, 0], [10, 0], [5, 8]])).toBe(true);
    expect(isSimpleRing([[0, 0], [10, 0], [20, 0], [20, 10], [0, 10]])).toBe(true);
  });
  it("rejects a repeated vertex, a touching edge and a flat ring", () => {
    expect(isSimpleRing([[0, 0], [10, 0], [10, 0], [10, 10], [0, 10]])).toBe(false);
    // the vertex at (5,0) touches the first edge
    expect(isSimpleRing([[0, 0], [10, 0], [10, 10], [5, 0], [0, 10]])).toBe(false);
    expect(isSimpleRing([[0, 0], [5, 0], [10, 0]])).toBe(false);
  });
});

describe("localFrame", () => {
  it("round-trips within a millimetre and matches geodesic distance within 0.1%", () => {
    const f = localFrame(32.85, 39.93);
    const p: [number, number] = [32.8617, 39.9372];
    const back = f.toLonLat(f.toLocal(p));
    const b = f.toLocal(back);
    const a = f.toLocal(p);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.001);
    // haversine on the WGS84 mean radius as the reference
    const R = 6371008.8;
    const rad = Math.PI / 180;
    const dLat = (p[1] - 39.93) * rad;
    const dLon = (p[0] - 32.85) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(39.93 * rad) * Math.cos(p[1] * rad) * Math.sin(dLon / 2) ** 2;
    const geo = 2 * R * Math.asin(Math.sqrt(h));
    expect(Math.abs(Math.hypot(a[0], a[1]) - geo) / geo).toBeLessThan(0.001);
  });
});
