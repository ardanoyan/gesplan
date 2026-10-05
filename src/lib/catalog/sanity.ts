/**
 * Plausibility checks on catalogue records, beyond what the schema can say. A record can parse
 * and still be wrong (swapped Voc/Vmp, a typo in the efficiency); these rules catch the usual
 * transcription slips. Null fields are never a problem here: unpublished values stay null.
 *
 * Type-only imports, so `node scripts/catalog-validate.ts` can load this file without a bundler.
 */
import type { CatalogFile, ModuleRecord } from "./schema";

const set = (v: number | null): v is number => v !== null;

/** Problems with one record, in Turkish; empty when the record looks sane. */
export function sanityProblems(m: ModuleRecord): string[] {
  const out: string[] = [];

  for (const key of ["efficiency_pct", "efficiency_max_pct"] as const) {
    const v = m[key];
    if (set(v) && !(v > 0 && v < 30)) out.push(`${key} 0 ile 30 arasında olmalı (${v})`);
  }
  if (set(m.v_oc) && set(m.v_mp) && !(m.v_oc > m.v_mp)) out.push(`v_oc (${m.v_oc}) v_mp (${m.v_mp}) değerinden büyük olmalı`);
  if (set(m.i_sc) && set(m.i_mp) && !(m.i_sc > m.i_mp)) out.push(`i_sc (${m.i_sc}) i_mp (${m.i_mp}) değerinden büyük olmalı`);
  if (set(m.length_mm) && set(m.width_mm) && !(m.length_mm > m.width_mm)) {
    out.push(`length_mm (${m.length_mm}) width_mm (${m.width_mm}) değerinden büyük olmalı; uzun kenar length_mm`);
  }

  const range = m.p_max_range_w;
  if (range && range.min > range.max) out.push(`p_max_range_w alt sınırı (${range.min}) üst sınırdan (${range.max}) büyük`);
  if (range && set(m.p_max_w) && (m.p_max_w < range.min || m.p_max_w > range.max)) {
    out.push(`p_max_w (${m.p_max_w}) p_max_range_w aralığının (${range.min}-${range.max}) dışında`);
  }

  if (set(m.bifaciality) && !(m.bifaciality > 0 && m.bifaciality <= 100)) {
    out.push(`bifaciality yüzde olarak 0 ile 100 arasında olmalı (${m.bifaciality})`);
  }

  // Power and voltage fall as the cell heats up; current rises slightly.
  if (set(m.gamma_pmax_pct_per_c) && !(m.gamma_pmax_pct_per_c < 0)) out.push(`gamma_pmax_pct_per_c negatif olmalı (${m.gamma_pmax_pct_per_c})`);
  if (set(m.beta_voc_pct_per_c) && !(m.beta_voc_pct_per_c < 0)) out.push(`beta_voc_pct_per_c negatif olmalı (${m.beta_voc_pct_per_c})`);
  if (set(m.alpha_isc_pct_per_c) && !(m.alpha_isc_pct_per_c > 0)) out.push(`alpha_isc_pct_per_c pozitif olmalı (${m.alpha_isc_pct_per_c})`);

  for (const key of ["warranty_product_years", "warranty_performance_years"] as const) {
    const v = m[key];
    if (set(v) && !(v >= 1 && v <= 50)) out.push(`${key} 1 ile 50 yıl arasında olmalı (${v})`);
  }

  // A series record covers several power variants, so one rated power cannot belong to it.
  if (m.record_level === "series" && m.p_max_w !== null) out.push(`series kaydında p_max_w boş olmalı (${m.p_max_w})`);

  return out;
}

/** Names of the fields that are null, in the record's key order. */
export function nullFields(m: ModuleRecord): string[] {
  return Object.entries(m)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
}

/** Every record's problems prefixed with its id, plus duplicate ids. */
export function catalogProblems(file: CatalogFile): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const m of file.modules) {
    if (seen.has(m.id) && !reported.has(m.id)) {
      out.push(`${m.id}: id birden fazla kayıtta kullanılmış`);
      reported.add(m.id);
    }
    seen.add(m.id);
    for (const p of sanityProblems(m)) out.push(`${m.id}: ${p}`);
  }
  return out;
}
