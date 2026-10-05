/** Turkish number formatting helpers (comma decimal, dot thousands). */
const cache = new Map<number, Intl.NumberFormat>();

export function fmt(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "-";
  let f = cache.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    cache.set(digits, f);
  }
  return f.format(value);
}

/** Parse user input that may use a comma or a dot as the decimal separator. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/\s/g, "");
  if (t === "") return null;
  const normalised = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

export function compass(azimuthDeg: number): string {
  const names = ["K", "KD", "D", "GD", "G", "GB", "B", "KB"];
  return names[Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8];
}
