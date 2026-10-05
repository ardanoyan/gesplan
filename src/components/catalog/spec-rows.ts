/**
 * Display text for catalogue records: labels, units and the spec tables. Pure, so the Turkish
 * wording and number formats are tested once and every view (card, detail, compare) agrees.
 * Missing values always read "Veri yok"; nothing here may fill in a typical value.
 */
import { powerRange } from "@/lib/catalog/filters";
import type { ModuleRecord, Technology } from "@/lib/catalog/schema";
import { isUsable } from "@/lib/catalog/select";
import { fmt } from "@/lib/format";

export const NO_DATA = "Veri yok";
export const ATTRIBUTION = "Ürün verileri üreticinin yayınladığı teknik dokümanlardan alınmıştır; doğrulanana kadar bilgi amaçlıdır.";
export const COMPARE_LIMIT = 3;
export const COMPARE_LIMIT_TEXT = "En fazla 3 panel karşılaştırılabilir.";
export const NO_DESIGN_TEXT = "Karşılaştırmak için önce tasarıma bir çatı yüzeyi ekleyin.";

/** A number with only the decimals it needs (600, 22,7, 23,42), in tr-TR format. */
export function num(value: number, maxDigits = 2): string {
  let d = 0;
  while (d < maxDigits && Number(value.toFixed(d)) !== value) d++;
  return fmt(value, d);
}

/** "600 W" for a variant, "570-605 W" for a series that only publishes a range. */
export function powerLabel(m: ModuleRecord): string {
  const r = powerRange(m);
  if (!r) return NO_DATA;
  return r.min === r.max ? `${num(r.min)} W` : `${num(r.min)}-${num(r.max)} W`;
}

/** Turkish writes the percent sign first: "%22,7", or "en fazla %23,42" for a series maximum. */
export function efficiencyLabel(m: ModuleRecord): string {
  if (m.efficiency_pct !== null) return `%${num(m.efficiency_pct)}`;
  if (m.efficiency_max_pct !== null) return `en fazla %${num(m.efficiency_max_pct)}`;
  return NO_DATA;
}

export function dimensionsLabel(m: ModuleRecord): string {
  if (m.length_mm === null || m.width_mm === null) return "Boyut verisi yok";
  return `${num(m.length_mm)} × ${num(m.width_mm)} mm`;
}

export function technologyLabel(t: Technology): string {
  return t === "topcon" ? "TOPCon" : t === "perc" ? "PERC" : "Teknoloji belirtilmemiş";
}

/** Null when the document does not say, so no badge is shown rather than a guess. */
export function bifacialLabel(b: boolean | null): string | null {
  return b === null ? null : b ? "Çift yüzlü" : "Tek yüzlü";
}

const FRAME_COLOURS: Record<string, string> = {
  black: "Siyah",
  silver: "Gümüş",
  white: "Beyaz",
  grey: "Gri",
  gray: "Gri",
};

/** Turkish name for the common frame colour values; anything else is shown as published. */
export function frameColourLabel(c: string): string {
  return FRAME_COLOURS[c.toLocaleLowerCase("en")] ?? c;
}

/** Why a record cannot drive the packer, or null when it can. */
export function unusableReason(m: ModuleRecord): string | null {
  if (isUsable(m)) return null;
  const noSize = m.length_mm === null || m.width_mm === null;
  const noPower = m.p_max_w === null;
  if (noSize && noPower) return "Boyut ve güç verisi yok; yerleşim hesaplanamaz.";
  return noSize ? "Boyut verisi yok; yerleşim hesaplanamaz." : "Güç verisi yok; yerleşim hesaplanamaz.";
}

export function fetchedAtLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NO_DATA;
  // A fixed zone keeps the server render and the browser on the same calendar day.
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
}

export function countLabel(shown: number, total: number): string {
  if (total === 0) return "Katalogda panel yok";
  if (shown === 0) return "Filtreye uyan panel yok";
  return `${fmt(shown)} panel`;
}

export interface SpecRow {
  key: keyof ModuleRecord;
  label: string;
  value: string;
  missing: boolean;
}

export interface SpecGroup {
  title: string;
  rows: SpecRow[];
}

const withUnit = (unit: string, digits = 2) => (v: number) => `${num(v, digits)} ${unit}`;
const percent = (v: number) => `%${num(v)}`;
const years = (v: number) => `${num(v)} yıl`;
const coefficient = (v: number) => `${num(v, 3)} %/°C`;

function row<K extends keyof ModuleRecord>(
  m: ModuleRecord,
  key: K,
  label: string,
  format: (v: NonNullable<ModuleRecord[K]>) => string,
): SpecRow {
  const v = m[key];
  if (v === null || v === undefined) return { key, label, value: NO_DATA, missing: true };
  return { key, label, value: format(v as NonNullable<ModuleRecord[K]>), missing: false };
}

const text = (v: string) => v;

/** Every schema field except the links and notes, which the detail view renders on its own. */
export function specGroups(m: ModuleRecord): SpecGroup[] {
  return [
    {
      title: "Genel",
      rows: [
        row(m, "brand", "Marka", text),
        row(m, "series", "Seri", text),
        row(m, "model", "Model", text),
        row(m, "record_level", "Kayıt düzeyi", (v) => (v === "series" ? "Seri (yalnızca güç aralığı)" : "Model")),
        row(m, "technology", "Hücre teknolojisi", (v) => technologyLabel(v)),
        row(m, "cell_count", "Hücre sayısı", (v) => num(v)),
        row(m, "bifacial", "Çift yüzlü", (v) => (v ? "Evet" : "Hayır")),
        row(m, "bifaciality", "Çift yüzlülük oranı", percent),
        row(m, "frame_color", "Çerçeve rengi", frameColourLabel),
      ],
    },
    {
      title: "Elektriksel değerler (STC)",
      rows: [
        row(m, "p_max_w", "Nominal güç (Pmax)", withUnit("W")),
        row(m, "p_max_range_w", "Güç aralığı", (r) => (r.min === r.max ? `${num(r.min)} W` : `${num(r.min)}-${num(r.max)} W`)),
        row(m, "power_tolerance", "Güç toleransı", text),
        row(m, "efficiency_pct", "Modül verimi", percent),
        row(m, "efficiency_max_pct", "En yüksek modül verimi", percent),
        row(m, "v_mp", "Maksimum güç gerilimi (Vmp)", withUnit("V")),
        row(m, "i_mp", "Maksimum güç akımı (Imp)", withUnit("A")),
        row(m, "v_oc", "Açık devre gerilimi (Voc)", withUnit("V")),
        row(m, "i_sc", "Kısa devre akımı (Isc)", withUnit("A")),
        row(m, "max_system_voltage_v", "En yüksek sistem gerilimi", withUnit("V")),
      ],
    },
    {
      title: "Sıcaklık",
      rows: [
        row(m, "gamma_pmax_pct_per_c", "Pmax sıcaklık katsayısı", coefficient),
        row(m, "beta_voc_pct_per_c", "Voc sıcaklık katsayısı", coefficient),
        row(m, "alpha_isc_pct_per_c", "Isc sıcaklık katsayısı", coefficient),
        row(m, "noct_c", "NOCT", withUnit("°C", 1)),
      ],
    },
    {
      title: "Mekanik",
      rows: [
        row(m, "length_mm", "Boy", withUnit("mm", 1)),
        row(m, "width_mm", "En", withUnit("mm", 1)),
        row(m, "thickness_mm", "Kalınlık", withUnit("mm", 1)),
        row(m, "weight_kg", "Ağırlık", withUnit("kg", 1)),
      ],
    },
    {
      title: "Garanti ve yaşlanma",
      rows: [
        row(m, "warranty_product_years", "Ürün garantisi", years),
        row(m, "warranty_performance_years", "Performans garantisi", years),
        row(m, "degradation_year1_pct", "İlk yıl güç kaybı", percent),
        row(m, "degradation_yearly_pct", "Yıllık güç kaybı", percent),
      ],
    },
    {
      title: "Kayıt",
      rows: [
        row(m, "id", "Kayıt kimliği", text),
        row(m, "version", "Kayıt sürümü", text),
        row(m, "fetched_at", "Veri tarihi", fetchedAtLabel),
        row(m, "verified", "Doğrulama", (v) => (v ? "Doğrulandı" : "Doğrulanmadı")),
      ],
    },
  ];
}

/** Fields the detail view shows outside the spec table (as links or a list). */
export const SPEC_FIELDS_SHOWN_ELSEWHERE = ["datasheet_url", "source_url", "notes"] as const;

export interface CompareRow {
  label: string;
  values: string[];
}

/** Rows of the comparison table, one value per candidate in the given order. */
export function compareRows(candidates: ModuleRecord[]): CompareRow[] {
  const specs = candidates.map((c) => specGroups(c).flatMap((g) => g.rows));
  const pick = (key: keyof ModuleRecord, label: string) => ({
    label,
    values: specs.map((rows) => rows.find((r) => r.key === key)?.value ?? NO_DATA),
  });
  return [
    { label: "Marka", values: candidates.map((c) => c.brand) },
    { label: "Güç", values: candidates.map(powerLabel) },
    { label: "Verim", values: candidates.map(efficiencyLabel) },
    { label: "Boyut", values: candidates.map(dimensionsLabel) },
    { label: "Teknoloji", values: candidates.map((c) => technologyLabel(c.technology)) },
    { label: "Çift yüzlü", values: candidates.map((c) => bifacialLabel(c.bifacial) ?? NO_DATA) },
    pick("power_tolerance", "Güç toleransı"),
    pick("gamma_pmax_pct_per_c", "Pmax sıcaklık katsayısı"),
    pick("weight_kg", "Ağırlık"),
    pick("warranty_product_years", "Ürün garantisi"),
    pick("warranty_performance_years", "Performans garantisi"),
    { label: "Tasarımda kullanım", values: candidates.map((c) => unusableReason(c) ?? "Kullanılabilir") },
    { label: "Doğrulama", values: candidates.map((c) => (c.verified ? "Doğrulandı" : "Doğrulanmadı")) },
  ];
}
