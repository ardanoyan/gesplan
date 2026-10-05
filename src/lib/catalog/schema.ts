/**
 * Module catalogue record. Shared by the seed file, the HTTP source and the UI, so the same
 * validation runs whichever source is active.
 *
 * Every value must come from a published document; anything not printed is null, never a
 * typical value. `verified` stays false until a person has checked the record against the
 * manufacturer's datasheet. Lengths are millimetres, temperature coefficients %/°C,
 * `bifaciality` is a percentage (e.g. 80).
 *
 * `record_level: "series"` marks a record for a whole product line whose document gives only a
 * power range (`p_max_range_w`) and a maximum efficiency; `p_max_w` and `efficiency_pct` are then
 * null because they belong to one power variant.
 */
import { z } from "zod";

const num = z.number().finite();
const nullableNum = num.nullable();
const positive = num.positive().nullable();

export const technologySchema = z.enum(["topcon", "perc", "unknown"]);
export type Technology = z.infer<typeof technologySchema>;

export const moduleRecordSchema = z.object({
  id: z.string().min(1),
  /** Changes whenever the record's values change; design files store it next to the id. */
  version: z.string().min(1),
  record_level: z.enum(["series", "variant"]),
  brand: z.string().min(1),
  series: z.string().nullable(),
  model: z.string().nullable(),
  technology: technologySchema,
  cell_count: num.int().positive().nullable(),
  bifacial: z.boolean().nullable(),
  bifaciality: positive,
  p_max_w: positive,
  p_max_range_w: z.object({ min: num.positive(), max: num.positive() }).nullable(),
  v_mp: positive,
  i_mp: positive,
  v_oc: positive,
  i_sc: positive,
  efficiency_pct: positive,
  efficiency_max_pct: positive,
  gamma_pmax_pct_per_c: nullableNum,
  beta_voc_pct_per_c: nullableNum,
  alpha_isc_pct_per_c: nullableNum,
  noct_c: positive,
  length_mm: positive,
  width_mm: positive,
  thickness_mm: positive,
  weight_kg: positive,
  max_system_voltage_v: positive,
  frame_color: z.string().nullable(),
  power_tolerance: z.string().nullable(),
  warranty_product_years: positive,
  warranty_performance_years: positive,
  degradation_year1_pct: positive,
  degradation_yearly_pct: positive,
  datasheet_url: z.url().nullable(),
  source_url: z.url(),
  fetched_at: z.iso.datetime(),
  verified: z.boolean(),
  notes: z.array(z.string()),
});
export type ModuleRecord = z.infer<typeof moduleRecordSchema>;

/** Seed file and HTTP list response share this envelope. */
export const catalogFileSchema = z.object({
  catalog_version: z.string().min(1),
  modules: z.array(moduleRecordSchema),
});
export type CatalogFile = z.infer<typeof catalogFileSchema>;

/** This app's own GET /api/catalog/modules response (what the client hooks read). */
export const catalogResponseSchema = catalogFileSchema.extend({ source: z.enum(["static", "http"]) });
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;
/** This app's own GET /api/catalog/modules/[id] response; unknown ids answer 404. */
export const moduleResponseSchema = z.object({ module: moduleRecordSchema });

export interface ModuleRef {
  id: string;
  version: string;
}
