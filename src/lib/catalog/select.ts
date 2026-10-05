/**
 * Which module the design packs with. A catalogue record can drive the packer only when its
 * datasheet gave length, width and rated power ("usable"); until one does, designs keep the
 * placeholder the prototype has always used, clearly labelled as such.
 */
import type { ModuleSpec } from "@/lib/geo/layout";
import type { ModuleRecord, ModuleRef } from "./schema";

export type UsableModule = ModuleRecord & { length_mm: number; width_mm: number; p_max_w: number };

/** The module the packer and totals use, whether it came from the catalogue or not. */
export interface ActiveModule {
  ref: ModuleRef;
  label: string;
  wp: number;
  lengthM: number;
  widthM: number;
  placeholder: boolean;
  record: UsableModule | null;
}

// Dimensions match a common 2278 x 1134 mm format; not a Kıvanç product and not verified.
export const PLACEHOLDER_MODULE: ActiveModule = {
  ref: { id: "placeholder", version: "1" },
  label: "Yer tutucu modül",
  wp: 590,
  lengthM: 2.278,
  widthM: 1.134,
  placeholder: true,
  record: null,
};

export function isUsable(m: ModuleRecord): m is UsableModule {
  return m.length_mm !== null && m.width_mm !== null && m.p_max_w !== null;
}

export function moduleLabel(m: ModuleRecord): string {
  return [m.series, m.model].filter(Boolean).join(" ") || m.id;
}

export function toActiveModule(m: UsableModule): ActiveModule {
  return {
    ref: { id: m.id, version: m.version },
    label: moduleLabel(m),
    wp: m.p_max_w,
    lengthM: m.length_mm / 1000,
    widthM: m.width_mm / 1000,
    placeholder: false,
    record: m,
  };
}

/**
 * Default: the env-configured record if it is usable, else the most powerful usable TOPCon
 * record, else the most powerful usable record of any technology, else the placeholder.
 */
export function pickDefaultModule(modules: ModuleRecord[], envId?: string | null): ActiveModule {
  const usable = modules.filter(isUsable);
  const fromEnv = envId ? usable.find((m) => m.id === envId) : undefined;
  if (fromEnv) return toActiveModule(fromEnv);
  const byPower = (list: UsableModule[]) => [...list].sort((a, b) => b.p_max_w - a.p_max_w)[0];
  const best = byPower(usable.filter((m) => m.technology === "topcon")) ?? byPower(usable);
  return best ? toActiveModule(best) : PLACEHOLDER_MODULE;
}

/** The module a saved design refers to, falling back to the default when it is gone or unusable. */
export function resolveModule(ref: ModuleRef | null, modules: ModuleRecord[], envId?: string | null): ActiveModule {
  if (ref && ref.id !== PLACEHOLDER_MODULE.ref.id) {
    const m = modules.find((r) => r.id === ref.id);
    if (m && isUsable(m)) return toActiveModule(m);
  }
  if (ref?.id === PLACEHOLDER_MODULE.ref.id && !modules.some(isUsable)) return PLACEHOLDER_MODULE;
  return pickDefaultModule(modules, envId);
}

export function moduleSpec(m: ActiveModule, gapM: number): ModuleSpec {
  return { wp: m.wp, lengthM: m.lengthM, widthM: m.widthM, gapM };
}
