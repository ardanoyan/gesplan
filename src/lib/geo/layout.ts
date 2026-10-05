/**
 * Module packing on one roof face or flat area (prototype of docs/05-engines.md 5.2).
 *
 * Frames: input footprints are in the local metric frame (metres, x east, y north).
 * Packing happens in the plane frame of the face: u runs along the eave, v runs up-slope,
 * and v is stretched by 1 / cos(slope) so distances are true lengths on the roof surface.
 * Azimuth follows pvlib: 0 = north, 90 = east, 180 = south, clockwise; it is the direction
 * the modules face (down-slope for a pitched face). Setbacks and clearances are metres
 * measured in the plane frame. Output rectangles are converted back to footprint coordinates.
 */
import {
  bbox,
  bboxesOverlap,
  isSimpleRing,
  pointInRing,
  ringArea,
  segmentDistance,
  toCounterClockwise,
  type BBox,
} from "./polygon";
import type { XY } from "./types";

export interface ModuleSpec {
  /** STC power in W. */
  wp: number;
  /** Long side in metres. */
  lengthM: number;
  /** Short side in metres. */
  widthM: number;
  /** Gap between neighbouring modules in metres. */
  gapM: number;
}

export type AreaKind = "pitched" | "flat";

export interface FaceSpec {
  kind: AreaKind;
  /** Roof slope in degrees from horizontal (pitched faces only; flat areas use 0). */
  tiltDeg: number;
  /** Direction the modules face, pvlib convention (180 = south). */
  azimuthDeg: number;
  /** Clearance from the face edge in metres. */
  setbackM: number;
  orientation: "portrait" | "landscape";
  /** Flat areas: rack tilt in degrees. */
  rackTiltDeg: number;
  /** Flat areas: module rows stacked on one rack table. */
  rowsPerTable: number;
  /** Flat areas: sun elevation in degrees below which rows may shade each other. */
  limitElevationDeg: number;
}

export interface ObstacleSpec {
  /** Obstacle footprint in the local frame (open ring). */
  footprint: XY[];
  /** Keep-clear distance around the obstacle in metres. */
  clearanceM: number;
}

export interface LayoutResult {
  /** Module rectangles in the local frame, four corners each. */
  modules: XY[][];
  count: number;
  kwp: number;
  footprintAreaM2: number;
  /** Roof surface area (footprint / cos slope). */
  surfaceAreaM2: number;
  /** Module surface area divided by roof surface area. */
  utilisation: number;
  /** Flat areas only: collector length / row pitch. */
  gcr: number | null;
  /** Flat areas only: row pitch in metres. */
  pitchM: number | null;
  /** Positions that fitted the face but were blocked by an obstacle. */
  removedByObstacles: number;
  /** Set when the face cannot be packed at all; the counts and areas are then zero. */
  invalidReason: "self-intersecting" | null;
}

const DEG = Math.PI / 180;
const EPS = 1e-9;
const MIN_CLEAR = 1e-6;

/**
 * Row pitch for racks so that a row does not shade the next one while the sun is above
 * `limitElevationDeg` (sun assumed normal to the rows): L cos b + L sin b / tan a.
 */
export function rackPitch(collectorLengthM: number, tiltDeg: number, limitElevationDeg: number): number {
  if (tiltDeg <= 0) return collectorLengthM;
  const b = tiltDeg * DEG;
  const a = Math.min(Math.max(limitElevationDeg, 1), 89) * DEG;
  return collectorLengthM * Math.cos(b) + (collectorLengthM * Math.sin(b)) / Math.tan(a);
}

/**
 * Consecutive edges within this angle of each other count as one straight edge. Vertices
 * clicked by eye along a gutter usually sit a degree or two off the line.
 */
const MERGE_EDGE_DEG = 3;

/** Unsigned angle in degrees between two vectors. */
function angleBetween(a: XY, b: XY): number {
  return Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])) / DEG;
}

/**
 * Suggested face azimuth: outward normal of the longest edge (taken as the eave).
 * Nearly collinear consecutive edges are merged first, so an extra vertex on the eave does
 * not hand the win to the ridge. When several edges are within 1% of the longest, the one
 * facing closest to south wins.
 */
export function suggestAzimuth(footprint: XY[]): number {
  const r = toCounterClockwise(footprint);
  const edges = r
    .map((p, i): XY => {
      const q = r[(i + 1) % r.length];
      return [q[0] - p[0], q[1] - p[1]];
    })
    .filter(([dx, dy]) => dx !== 0 || dy !== 0);
  const n = edges.length;
  if (n === 0) return 180;
  // start the walk at a corner so an eave split across the ring's first vertex stays whole
  const start = Math.max(0, edges.findIndex((e, i) => angleBetween(edges[(i + n - 1) % n], e) > MERGE_EDGE_DEG));
  // each line is the chord of a run of nearly collinear edges
  const lines: XY[] = [];
  for (let k = 0; k < n; k++) {
    const e = edges[(start + k) % n];
    const last = lines[lines.length - 1];
    if (last && angleBetween(last, e) <= MERGE_EDGE_DEG) {
      last[0] += e[0];
      last[1] += e[1];
    } else {
      lines.push([e[0], e[1]]);
    }
  }
  const lens = lines.map(([dx, dy]) => Math.hypot(dx, dy));
  const max = Math.max(...lens);
  let best = 180;
  let bestDiff = Infinity;
  lines.forEach(([dx, dy], i) => {
    if (lens[i] < 0.99 * max) return;
    const az = (Math.atan2(dy, -dx) / DEG + 360) % 360;
    const diff = Math.abs(((az - 180 + 540) % 360) - 180);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = az;
    }
  });
  const rounded = Math.round(best * 10) / 10;
  return rounded >= 360 ? rounded - 360 : rounded;
}

interface Plane {
  toPlane(p: XY): XY;
  fromPlane(p: XY): XY;
}

function makePlane(azimuthDeg: number, slopeDeg: number): Plane {
  const t = azimuthDeg * DEG;
  const c = Math.cos(slopeDeg * DEG);
  const u: XY = [-Math.cos(t), Math.sin(t)];
  const v: XY = [-Math.sin(t), -Math.cos(t)];
  return {
    toPlane: ([x, y]) => [x * u[0] + y * u[1], (x * v[0] + y * v[1]) / c],
    fromPlane: ([pu, pv]) => [pu * u[0] + pv * c * v[0], pu * u[1] + pv * c * v[1]],
  };
}

interface Prepared {
  ring: XY[];
  bb: BBox;
  edges: { a: XY; b: XY; bb: BBox }[];
  clearance: number;
}

function prepare(ring: XY[], clearance = 0): Prepared {
  return {
    ring,
    bb: bbox(ring),
    edges: ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length];
      return { a, b, bb: bbox([a, b]) };
    }),
    clearance,
  };
}

function rectCorners(u0: number, v0: number, w: number, h: number): XY[] {
  return [
    [u0, v0],
    [u0 + w, v0],
    [u0 + w, v0 + h],
    [u0, v0 + h],
  ];
}

function rectEdges(r: XY[]): [XY, XY][] {
  return [
    [r[0], r[1]],
    [r[1], r[2]],
    [r[2], r[3]],
    [r[3], r[0]],
  ];
}

function insideFace(r: XY[], rb: BBox, face: Prepared, setback: number): boolean {
  const s = Math.max(setback, MIN_CLEAR);
  if (rb[0] < face.bb[0] + s - EPS || rb[1] < face.bb[1] + s - EPS || rb[2] > face.bb[2] - s + EPS || rb[3] > face.bb[3] - s + EPS) {
    return false;
  }
  for (const p of r) if (!pointInRing(p, face.ring)) return false;
  const re = rectEdges(r);
  for (const e of face.edges) {
    if (!bboxesOverlap(e.bb, rb, s)) continue;
    for (const [c, d] of re) if (segmentDistance(e.a, e.b, c, d) < s - EPS) return false;
  }
  return true;
}

function clearOf(r: XY[], rb: BBox, ob: Prepared): boolean {
  const c = Math.max(ob.clearance, MIN_CLEAR);
  if (!bboxesOverlap(rb, ob.bb, c + EPS)) return true;
  for (const p of r) if (pointInRing(p, ob.ring)) return false;
  for (const p of ob.ring) {
    if (p[0] > rb[0] && p[0] < rb[2] && p[1] > rb[1] && p[1] < rb[3]) return false;
  }
  const re = rectEdges(r);
  for (const e of ob.edges) {
    if (!bboxesOverlap(e.bb, rb, c)) continue;
    for (const [a, b] of re) if (segmentDistance(e.a, e.b, a, b) < c - EPS) return false;
  }
  return true;
}

export interface LayoutOptions {
  /** Grid offsets tried per axis; more finds better fits on irregular faces but costs time. */
  offsetSteps?: number;
}

export function layoutFace(
  footprint: XY[],
  face: FaceSpec,
  obstacles: ObstacleSpec[],
  mod: ModuleSpec,
  options: LayoutOptions = {},
): LayoutResult {
  const fp = toCounterClockwise(footprint);
  const slope = face.kind === "pitched" ? Math.min(Math.max(face.tiltDeg, 0), 75) : 0;
  const plane = makePlane(face.azimuthDeg, slope);
  const faceP = prepare(fp.map(plane.toPlane));
  const obsP = obstacles
    .filter((o) => o.footprint.length >= 3)
    .map((o) => prepare(toCounterClockwise(o.footprint).map(plane.toPlane), Math.max(o.clearanceM, 0)));

  const footprintAreaM2 = ringArea(fp);
  const surfaceAreaM2 = footprintAreaM2 / Math.cos(slope * DEG);
  const empty: LayoutResult = {
    modules: [],
    count: 0,
    kwp: 0,
    footprintAreaM2,
    surfaceAreaM2,
    utilisation: 0,
    gcr: null,
    pitchM: null,
    removedByObstacles: 0,
    invalidReason: null,
  };
  if (fp.length < 3 || mod.lengthM <= 0 || mod.widthM <= 0) return empty;
  // In a crossing ring the lobes' shoelace areas cancel while even-odd filling still packs
  // both lobes, so counts and areas would disagree. Report it instead of packing it.
  if (!isSimpleRing(fp)) return { ...empty, footprintAreaM2: 0, surfaceAreaM2: 0, invalidReason: "self-intersecting" };

  const portrait = face.orientation === "portrait";
  const mu = portrait ? mod.widthM : mod.lengthM;
  const mv = portrait ? mod.lengthM : mod.widthM;
  const g = Math.max(mod.gapM, 0);
  const colStep = mu + g;

  let rowsInTable = 1;
  let tableDepth = mv;
  let moduleDepth = mv;
  let moduleStepV = mv + g;
  let rowStep = mv + g;
  let pitchM: number | null = null;
  let gcr: number | null = null;
  if (face.kind === "flat") {
    const beta = Math.min(Math.max(face.rackTiltDeg, 0), 60) * DEG;
    rowsInTable = Math.max(1, Math.round(face.rowsPerTable));
    const collector = rowsInTable * mv + (rowsInTable - 1) * g;
    tableDepth = collector * Math.cos(beta);
    moduleDepth = mv * Math.cos(beta);
    moduleStepV = (mv + g) * Math.cos(beta);
    pitchM = rackPitch(collector, beta / DEG, face.limitElevationDeg);
    rowStep = Math.max(pitchM, tableDepth + g);
    pitchM = rowStep;
    gcr = collector / rowStep;
  }

  const [minU, minV, maxU, maxV] = faceP.bb;
  const nU = Math.floor((maxU - minU) / colStep) + 1;
  const nV = Math.floor((maxV - minV) / rowStep) + 1;
  const steps = options.offsetSteps ?? (nU * nV > 20000 ? 3 : 6);

  let best: { u: number; v: number }[] = [];
  let bestRemoved = 0;
  for (let sv = 0; sv < steps; sv++) {
    for (let su = 0; su < steps; su++) {
      const du = (su * colStep) / steps;
      const dv = (sv * rowStep) / steps;
      const kept: { u: number; v: number }[] = [];
      let removed = 0;
      for (let j = 0; j < nV; j++) {
        const v0 = minV + dv + j * rowStep;
        if (v0 + tableDepth > maxV + EPS) break;
        for (let i = 0; i < nU; i++) {
          const u0 = minU + du + i * colStep;
          if (u0 + mu > maxU + EPS) break;
          const r = rectCorners(u0, v0, mu, tableDepth);
          const rb: BBox = [u0, v0, u0 + mu, v0 + tableDepth];
          if (!insideFace(r, rb, faceP, face.setbackM)) continue;
          if (obsP.every((o) => clearOf(r, rb, o))) kept.push({ u: u0, v: v0 });
          else removed += 1;
        }
      }
      // while nothing fits, still keep the blocked count so the obstacle is named as the cause
      if (kept.length > best.length || (best.length === 0 && removed > bestRemoved)) {
        best = kept;
        bestRemoved = removed;
      }
    }
  }

  const modules: XY[][] = [];
  for (const t of best) {
    for (let k = 0; k < rowsInTable; k++) {
      modules.push(rectCorners(t.u, t.v + k * moduleStepV, mu, moduleDepth).map(plane.fromPlane));
    }
  }
  const count = modules.length;
  return {
    modules,
    count,
    kwp: (count * mod.wp) / 1000,
    footprintAreaM2,
    surfaceAreaM2,
    utilisation: surfaceAreaM2 > 0 ? (count * mu * mv) / surfaceAreaM2 : 0,
    gcr,
    pitchM,
    removedByObstacles: bestRemoved * rowsInTable,
    invalidReason: null,
  };
}
