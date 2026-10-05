"""Merge two blind transcriptions into the catalogue seed. A value is kept only when both
transcribers wrote exactly the same thing; anything else becomes null with a note."""
import json
import sys

S = "data/catalog/provenance"  # run from the project root
OUT = "data/catalog/kivanc-modules.json"

a = {r["id"]: r for r in json.load(open(f"{S}/transcription-a.json"))["records"]}
b = {r["id"]: r for r in json.load(open(sys.argv[1] if len(sys.argv) > 1 else f"{S}/transcription-b.json"))}

FIELDS = ["series", "model", "technology", "cell_count", "bifacial", "bifaciality", "p_max_w",
          "p_max_range_min_w", "p_max_range_max_w", "v_mp", "i_mp", "v_oc", "i_sc", "efficiency_pct",
          "efficiency_max_pct", "gamma_pmax_pct_per_c", "beta_voc_pct_per_c", "alpha_isc_pct_per_c", "noct_c",
          "length_mm", "width_mm", "thickness_mm", "weight_kg", "max_system_voltage_v", "frame_color",
          "power_tolerance", "warranty_product_years", "warranty_performance_years", "degradation_year1_pct",
          "degradation_yearly_pct", "datasheet_url"]
PAGES = {
    "kivanc-topcon-610-640": "topcon-610-640w", "kivanc-topcon-570-605": "topcon570-605",
    "kivanc-monofacial": "monofacial-module", "kivanc-bifacial": "bifacial-module",
    "kivanc-glass-glass-bifacial": "glass-glass-bifacial-module", "kivanc-black-series": "black-series-module",
}
# Real download times of the sources the transcriptions read (file mtimes, converted to UTC).
FETCHED = {k: "2026-09-30T23:55:08Z" for k in PAGES}
FETCHED["kivanc-topcon-610-640"] = "2026-10-01T07:39:35Z"

COMMON_NOTES = [
    "Yalnızca veri sayfasının kapak sayfası yayımlanmış; elektriksel değerler, boyutlar, ağırlık ve sıcaklık katsayıları yayımlanmadığı için boş.",
    "Seri düzeyinde kayıt: kapakta güç aralığı ve en yüksek verim var, güç kademeleri listelenmemiş.",
    "Belgelerde marka KIVANÇ, sitede Kivanc Solar olarak geçiyor.",
    "İki bağımsız okumayla aktarıldı; iki okumanın aynı olmadığı alanlar boş bırakıldı.",
]

records, disagreements = [], []
for rid, page in PAGES.items():
    ra, rb = a.get(rid), b.get(rid)
    if ra is None or rb is None:
        raise SystemExit(f"missing transcription for {rid}")
    v, notes = {}, list(COMMON_NOTES)
    for k in FIELDS:
        if json.dumps(ra.get(k)) == json.dumps(rb.get(k)):
            v[k] = ra.get(k)
        else:
            v[k] = "unknown" if k == "technology" else None
            disagreements.append((rid, k, ra.get(k), rb.get(k)))
            notes.append(f"İki okuma {k} alanında farklı (A: {json.dumps(ra.get(k), ensure_ascii=False)}, B: {json.dumps(rb.get(k), ensure_ascii=False)}); veri sayfasıyla kontrol edilene kadar boş.")
    model = v["model"] or ""
    for seg in ("66H", "72H", "54B"):
        if seg in model:
            notes.append(f"Model kodundaki \"{seg}\" hücre sayısı olarak yazılmamış; hücre sayısı boş bırakıldı.")
    lo, hi = v.pop("p_max_range_min_w"), v.pop("p_max_range_max_w")
    records.append({
        "id": rid, "version": "seed-2026-10-01", "record_level": "series", "brand": "Kıvanç Enerji",
        "series": v["series"], "model": v["model"], "technology": v["technology"],
        "cell_count": v["cell_count"], "bifacial": v["bifacial"], "bifaciality": v["bifaciality"],
        "p_max_w": v["p_max_w"], "p_max_range_w": {"min": lo, "max": hi} if lo is not None and hi is not None else None,
        "v_mp": v["v_mp"], "i_mp": v["i_mp"], "v_oc": v["v_oc"], "i_sc": v["i_sc"],
        "efficiency_pct": v["efficiency_pct"], "efficiency_max_pct": v["efficiency_max_pct"],
        "gamma_pmax_pct_per_c": v["gamma_pmax_pct_per_c"], "beta_voc_pct_per_c": v["beta_voc_pct_per_c"],
        "alpha_isc_pct_per_c": v["alpha_isc_pct_per_c"], "noct_c": v["noct_c"],
        "length_mm": v["length_mm"], "width_mm": v["width_mm"], "thickness_mm": v["thickness_mm"],
        "weight_kg": v["weight_kg"], "max_system_voltage_v": v["max_system_voltage_v"],
        "frame_color": v["frame_color"], "power_tolerance": v["power_tolerance"],
        "warranty_product_years": v["warranty_product_years"], "warranty_performance_years": v["warranty_performance_years"],
        "degradation_year1_pct": v["degradation_year1_pct"], "degradation_yearly_pct": v["degradation_yearly_pct"],
        "datasheet_url": v["datasheet_url"], "source_url": f"https://www.kivancsolar.com/urunler/solar-paneller/{page}",
        "fetched_at": FETCHED[rid], "verified": False, "notes": notes,
    })

import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({"catalog_version": "seed-2026-10-01", "modules": records}, open(OUT, "w"), ensure_ascii=False, indent=2)
open(OUT, "a").write("\n")
print(f"wrote {len(records)} records; {len(disagreements)} disagreements")
for d in disagreements:
    print("  DISAGREE", d)
