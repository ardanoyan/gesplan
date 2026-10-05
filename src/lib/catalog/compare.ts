/**
 * "Bu tasarımda": how many modules of each candidate fit the current design and what kWp that
 * gives. Runs the unchanged packer once per face per candidate; only the module dimensions and
 * power differ between candidates.
 */
import { layoutFace, type FaceSpec, type ObstacleSpec } from "@/lib/geo/layout";
import type { XY } from "@/lib/geo/types";
import type { ModuleRecord } from "./schema";
import { isUsable, moduleSpec, toActiveModule } from "./select";

/** The parts of a design the comparison needs, already in the local metric frame. */
export interface DesignSnapshot {
  faces: { id: string; name: string; footprint: XY[]; face: FaceSpec }[];
  obstacles: ObstacleSpec[];
  gapM: number;
}

export type CandidateResult =
  | { id: string; usable: false }
  | { id: string; usable: true; count: number; kwp: number; perFace: { id: string; name: string; count: number; kwp: number }[] };

export function compareOnDesign(candidates: ModuleRecord[], design: DesignSnapshot): CandidateResult[] {
  return candidates.map((c) => {
    if (!isUsable(c)) return { id: c.id, usable: false };
    const spec = moduleSpec(toActiveModule(c), design.gapM);
    const perFace = design.faces.map((f) => {
      const res = layoutFace(f.footprint, f.face, design.obstacles, spec);
      return { id: f.id, name: f.name, count: res.count, kwp: res.kwp };
    });
    return {
      id: c.id,
      usable: true,
      count: perFace.reduce((s, f) => s + f.count, 0),
      kwp: perFace.reduce((s, f) => s + f.kwp, 0),
      perFace,
    };
  });
}
