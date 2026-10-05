# Module catalogue seed

`kivanc-modules.json` is a development seed for the Kıvanç Enerji solar module catalogue.
It was transcribed by hand from documents the manufacturer publishes on its public website.
It is not an official data feed, and nothing in it implies a partnership, certification or endorsement.

Every document was transcribed twice, independently.
Where the two transcriptions disagreed, the value was left `null` instead of picking one.
Every record is `verified: false` until a person has checked it against the full datasheet (see "Verified policy").
The app labels catalogue views with: "Ürün verileri üreticinin yayınladığı teknik dokümanlardan alınmıştır; doğrulanana kadar bilgi amaçlıdır."

The app reads this file through `StaticCatalogSource` (`src/lib/catalog/source.ts`), the default and development source.
Switching to an official HTTP endpoint is described in the project README, section "Katalog".

## What the public site publishes

The product listing at https://www.kivancsolar.com/urunler/solar-paneller shows six panel products.
Each product shows only the cover page of its datasheet, as an image.
A cover gives the series name, the power range, the maximum efficiency, the product and performance warranties and the power tolerance.
It does not give dimensions, weight, the electrical table per power class (Vmp, Imp, Voc, Isc), temperature coefficients or NOCT.

That is why the seed holds six series-level records (`record_level: "series"`), one per product.
Their `p_max_w`, `length_mm` and `width_mm` are `null`, so none of them is "usable": the packer needs length, width and rated power.
They can be browsed and compared on their published specs, but they cannot be selected for a layout, and designs keep the placeholder module ("Yer tutucu modül") until a usable record exists.

The published documents spell the brand "KIVANÇ" or "Kivanc Solar".
The app always says "Kıvanç Enerji"; the published spelling belongs in a record's `notes`, not in UI text.

## Field rules

- A value is filled only when a published document prints it; anything else is `null`, never a typical or estimated value.
- Units: millimetres for lengths, kilograms, volts, amperes, %/°C for temperature coefficients, and `bifaciality` as a percentage (80, not 0.8).
- A series record carries `p_max_range_w` and `efficiency_max_pct`; `p_max_w` and `efficiency_pct` stay `null` because they belong to one power variant.
- `version` changes whenever any value of the record changes, because saved designs store the id together with the version.
- `source_url` is the page the values were read from, `fetched_at` is when it was fetched, and `notes` explains anything unusual (an unreadable value, a disagreement, the published spelling).

## Refreshing the seed

1. Fetch the listing page and each product page, then download every cover image listed in the source manifest below.
2. Compare each image's sha256 with the manifest; if none changed and no product was added or removed, stop here.
3. Transcribe each new or changed cover twice, independently, and compare the two results field by field.
4. Write the agreed values into the records and leave every disagreement `null`, with a short note.
5. Bump `version` on every record whose values changed, set `verified` back to `false` on those records, and update `fetched_at`.
6. Bump `catalog_version` for the file.
7. Update the manifest below (URLs, sha256, fetch date).
8. Run `npm run catalog:validate` and fix every error it reports; it must exit with status 0.

`catalog:validate` checks the schema and the sanity rules in `src/lib/catalog/sanity.ts`, and lists the null fields of every record.
Null fields are reported, not failed.

## Verified policy

`verified: true` means a named person has checked the record against the manufacturer's full datasheet.
A transcription, a script or an AI tool never sets it.

- Only someone holding the full datasheet (with the electrical and mechanical tables), obtained from the manufacturer or the partner, may set it.
- They check every non-null value against that datasheet, including units, the series and model names, the power range, efficiency, warranties and tolerance.
- They check length, width and rated power with particular care, because those drive the module layout and the kWp totals.
- They make sure `datasheet_url` and `source_url` point to the document they checked.
- They add a note saying who verified the record, when, and against which document and revision.
- A second person reviews the change before it is merged.
- Any later change to a value sets `verified` back to `false` and bumps `version`.

## Source manifest

Fetched on 2026-10-01 from https://www.kivancsolar.com/urunler/solar-paneller.
Hashes are sha256 of the downloaded files.

| Product | Cover image | sha256 |
| --- | --- | --- |
| TOPCON 570-605W | https://www.kivancsolar.com/assets/uploads/products/products/list/498_k228177van227167_quantum_topcon_570-605w.jpg | `237d85b364634d6069be52c3b6ebd1a8c72528c42e04ed5bc294375ba21a43c5` |
| MONOFACIAL MODULE | https://www.kivancsolar.com/assets/uploads/products/products/list/412_k228177van227167_monofacial_datasheet_3page-0001_-_kopya.jpg | `104d6105601821156042439ac30c9dd641594ee62aa926be3c88388596c8e156` |
| BIFACIAL MODULE | https://www.kivancsolar.com/assets/uploads/products/products/list/58_k228177van227167_bifacial_datasheet_6page-0001.jpg | `08a152ad47fcd35c9a7966ac4252116008bf4c5b8279ac08cc8ab354aa371534` |
| GLASS-GLASS BIFACIAL MODULE | https://www.kivancsolar.com/assets/uploads/products/products/list/465_glass-_glass1.jpg | `e8eaac40379dcacc54ec265e601078d3a56e57b798e279ef0a111cb084e38606` |
| BLACK SERİES MODULE | https://www.kivancsolar.com/assets/uploads/products/products/list/228_blackseries1.jpg | `14e3435c14946949801fe880bc29455b5189284d2109af892ff7cb0ad71a42d3` |
| TOPCON 610-640W | https://www.kivancsolar.com/assets/uploads/products/products/list/558_k228177van227167_quantum_topcon_610-640w_1.svg | `ff65c6c96ee0309fadbbbe13ac4e38496e498872a15fbff838230f3d8fa94727` |

The first five covers are JPEG images.
The TOPCON 610-640W cover is published as an SVG (707,924 bytes on the fetch date); it was rendered to an image for transcription.

Product pages:

- https://www.kivancsolar.com/urunler/solar-paneller/topcon570-605
- https://www.kivancsolar.com/urunler/solar-paneller/monofacial-module
- https://www.kivancsolar.com/urunler/solar-paneller/bifacial-module
- https://www.kivancsolar.com/urunler/solar-paneller/glass-glass-bifacial-module
- https://www.kivancsolar.com/urunler/solar-paneller/black-series-module
- https://www.kivancsolar.com/urunler/solar-paneller/topcon-610-640w
