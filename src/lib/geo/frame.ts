import proj4 from "proj4";
import type { LonLat, XY } from "./types";

/**
 * Local metric frame: Transverse Mercator centred on the site, same definition as the plan's
 * server-side `LocalCRS` (docs/05-engines.md 5.1), so client and server lengths agree.
 */
export interface LocalFrame {
  lon0: number;
  lat0: number;
  toLocal(p: LonLat): XY;
  toLonLat(p: XY): LonLat;
}

export function localFrame(lon0: number, lat0: number): LocalFrame {
  const def = `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs`;
  const conv = proj4("EPSG:4326", def);
  return {
    lon0,
    lat0,
    toLocal: (p) => conv.forward([p[0], p[1]]) as XY,
    toLonLat: (p) => conv.inverse([p[0], p[1]]) as LonLat,
  };
}

/** Mean of all vertices; good enough as a frame origin for sites a few hundred metres wide. */
export function meanLonLat(rings: LonLat[][]): LonLat | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
      n += 1;
    }
  }
  return n === 0 ? null : [sx / n, sy / n];
}
