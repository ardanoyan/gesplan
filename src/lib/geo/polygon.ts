import type { XY } from "./types";

const EPS = 1e-9;

/** Drop the closing vertex of a GeoJSON-style ring if it repeats the first one. */
export function openRing(ring: XY[]): XY[] {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring;
}

/** Shoelace area in m2; positive for counter-clockwise rings (x east, y north). */
export function signedArea(r: XY[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function ringArea(r: XY[]): number {
  return Math.abs(signedArea(r));
}

export function toCounterClockwise(r: XY[]): XY[] {
  return signedArea(r) < 0 ? [...r].reverse() : r;
}

/** Ray-casting point-in-polygon; points exactly on the boundary may go either way. */
export function pointInRing(p: XY, r: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function orient(a: XY, b: XY, c: XY): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: XY, b: XY, p: XY): boolean {
  return (
    Math.min(a[0], b[0]) - EPS <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + EPS &&
    Math.min(a[1], b[1]) - EPS <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + EPS
  );
}

/** True if segments ab and cd share at least one point (touching counts). */
export function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) && ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))) {
    return true;
  }
  if (Math.abs(o1) <= EPS && onSegment(a, b, c)) return true;
  if (Math.abs(o2) <= EPS && onSegment(a, b, d)) return true;
  if (Math.abs(o3) <= EPS && onSegment(c, d, a)) return true;
  if (Math.abs(o4) <= EPS && onSegment(c, d, b)) return true;
  return false;
}

/**
 * True when an open ring bounds a single region: no repeated vertex, no two non-adjacent
 * edges crossing or touching (collinear overlap included) and a non-zero area.
 * An extra vertex on a straight edge is fine; a bow-tie drawn in Z order is not.
 */
export function isSimpleRing(r: XY[]): boolean {
  const n = r.length;
  if (n < 3) return false;
  const [minX, minY, maxX, maxY] = bbox(r);
  const size = Math.hypot(maxX - minX, maxY - minY);
  // relative to the ring's size so a fold-flat ring fails at any scale
  if (ringArea(r) <= 1e-9 * size * size) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(r[i][0] - r[j][0]) <= EPS && Math.abs(r[i][1] - r[j][1]) <= EPS) return false;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (!adjacent && segmentsIntersect(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return false;
    }
  }
  return true;
}

export function pointSegmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Minimum distance between segments ab and cd (0 when they intersect). */
export function segmentDistance(a: XY, b: XY, c: XY, d: XY): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

export type BBox = [number, number, number, number];

export function bbox(r: XY[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of r) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function bboxesOverlap(a: BBox, b: BBox, margin = 0): boolean {
  return a[0] - margin <= b[2] && b[0] - margin <= a[2] && a[1] - margin <= b[3] && b[1] - margin <= a[3];
}

export function edgeLengths(r: XY[]): number[] {
  return r.map((p, i) => {
    const q = r[(i + 1) % r.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
}
