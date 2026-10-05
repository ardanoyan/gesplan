# GESPlan prototype

A browser-based rooftop solar design tool: find the building on satellite imagery, draw the roof faces and obstacles, get an automatic module layout with counts, kWp and row pitch, and an annual yield figure from PVGIS. Built with Next.js, TypeScript, MapLibre GL and Terra Draw; the layout geometry runs in the browser (`src/lib/geo/layout.ts`). The UI is in Turkish because the first users are Turkish installers. The idea came from an internship at a solar company.

Front-end-only prototype of the GESPlan design canvas.
It exists to show the core loop early (find the site, draw the roof, get a module layout and a yield figure) and to test the geometry approach before a full product is built.
It is a prototype: no database, no login, no API server beyond a few small route handlers (two proxies and the module catalogue).

## Run it

```bash
npm install
npm run dev
```

Open the printed localhost URL.
`npm test` runs the Vitest suite (geometry, formatting, proxy routes and the catalogue); `npm run typecheck` and `npm run lint` check types and lint.
`npm run test:e2e` runs the Playwright browser checks in `e2e/` with one worker; it reuses a dev server already running on port 3000 or starts one.
The browser checks answer every catalogue request from the fake fixture `e2e/fixtures/catalog-fixture.json` (brand `TEST-FIXTURE`), so they do not depend on the seed or on `.env.local`.

## What works

- Satellite basemap (Esri World Imagery, keyless) with address search through OpenStreetMap Nominatim, limited to Türkiye.
- Drawing and editing roof faces and obstacles with Terra Draw (vertex drag, midpoint insert, delete); shortcuts R roof, E obstacle, V select, Delete or Backspace removes the selection (also after picking a roof in the table, but not while typing in a field).
- A roof or obstacle whose edges cross cannot be closed, and a notice over the map says why; a crossing face from an older save is flagged in the panel and gets no modules instead of counts that do not match its area.
- Automatic module layout computed in the browser (`src/lib/geo/layout.ts`):
  - pitched faces with flush mounting, laid out in the roof plane so the slope adds surface (footprint / cos tilt);
  - flat roofs with south-facing (or any azimuth) racks, row pitch from the limit-angle formula `L cos b + L sin b / tan a`, 1 or 2 rows per table;
  - uniform setback, obstacle clearance, portrait or landscape, grid-offset search for the best fit;
  - azimuth suggestion from the longest edge (the eave), with nearly collinear edges merged so an extra vertex on the eave does not flip it, plus flip and "south" buttons.
- Live counters per face and in total: modules, kWp, roof surface area, GCR and row pitch or area utilisation.
- Annual yield reference from PVGIS 5.3 (`/api/pvgis`), clearly labelled as PVGIS's own model with 14% system loss (cables, inverter, soiling), without obstacle or row shading.
  The route asks PVGIS for 1 kWp with free-standing mounting and scales the result by each face's kWp, so any face size works; the note under the result says roof-parallel modules run warmer than that.
  A face that fails is listed and left out of the total instead of dropping the whole estimate.
- Both proxy routes keep a bounded in-memory cache (500 entries, 24 h) and throttle upstream calls: Nominatim gets at most one call per 1.1 s, PVGIS at most two at a time.
- Solar module catalogue (see "Katalog" below): `/paneller` and the designer's "Panel seç" sheet list, search, filter and compare panels, and the sheet compares candidates on the current roofs ("Bu tasarımda") before "Bu paneli seç" repacks every face.
  Filters live in the URL, so a filtered list can be shared.
  "Nasıl çalışır?" opens a 4-step tour; finishing it is remembered in localStorage under `gesplan-tutorial-panels-v1`.
- Design saved in the browser's localStorage and restored on reload, including the chosen catalogue module (id and record version) and the module gap; "Tasarımı sıfırla" clears it.
  Saves from before the catalogue keep their roofs and gap and switch to the catalogue default module.
- Turkish UI with Turkish number input (comma decimals).

## Katalog

The designer and `/paneller` read the solar module catalogue only through this app's own route handlers:

- `GET /api/catalog/modules` answers `{ catalog_version, source, modules }`, where `source` is `"static"` or `"http"`.
- `GET /api/catalog/modules/{id}` answers `{ module }`, or 404 with `{ "error": "Panel bulunamadı" }` for an unknown id.
- A failing source answers 502 with `{ "error": "..." }`, a Turkish message that is safe to show.

The source is picked on the server (`src/lib/catalog/source.ts`), so its address and API key never reach the browser.

### Environment variables

Copy `.env.example` to `.env.local`; an empty value counts as unset, and `npm run dev` must be restarted after a change.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CATALOG_SOURCE` | `static` | `static` reads the seed file, `http` reads an HTTP endpoint; anything else is a configuration error (502). |
| `CATALOG_API_BASE_URL` | none | Base URL of the HTTP catalogue, required when `CATALOG_SOURCE=http`; a trailing slash is fine. |
| `CATALOG_API_KEY` | none | Optional key for the HTTP catalogue, sent as `Authorization: Bearer <key>` from the server. Server-only: never give it a `NEXT_PUBLIC_` prefix. |
| `CATALOG_SEED_PATH` | `data/catalog/kivanc-modules.json` | Seed file for the static source, relative to the project root. |
| `NEXT_PUBLIC_DEFAULT_MODULE_ID` | none | Catalogue id new designs start with, used only when that record is usable. |

### Static seed (default)

`data/catalog/kivanc-modules.json` is a development seed transcribed from the manufacturer's public documents; `data/catalog/README.md` explains where it comes from.
The public site only publishes datasheet cover pages, so today the seed holds six series-level records without dimensions or rated power.
None of them is usable for a layout yet, so designs keep the placeholder module ("Yer tutucu modül").

### Usable records and the default module

A record can drive the packer only when `length_mm`, `width_mm` and `p_max_w` are all set (`isUsable` in `src/lib/catalog/select.ts`).
Other records can be browsed and compared on their published specs, but "Bu paneli seç" stays disabled with "Boyut ve güç verisi yok; yerleşim hesaplanamaz."
The default module is `NEXT_PUBLIC_DEFAULT_MODULE_ID` if that record is usable, else the most powerful usable TOPCon record, else the most powerful usable record, else the placeholder.

### Switching from the static seed to HTTP

1. In a second terminal, start the local mock endpoint: `npm run catalog:mock`.
   It serves the seed at `http://localhost:4010` and re-reads the file on every request.
   `MOCK_CATALOG_FILE=e2e/fixtures/catalog-fixture.json npm run catalog:mock` serves the fake test catalogue instead, which has usable records.
   `MOCK_CATALOG_KEY=<key>` makes it require `Authorization: Bearer <key>`, `MOCK_CATALOG_FAIL=1` makes every request answer 500, and `MOCK_CATALOG_PORT` changes the port.
2. In `.env.local`, set `CATALOG_SOURCE=http` and `CATALOG_API_BASE_URL=http://localhost:4010` (plus `CATALOG_API_KEY` if the mock requires one).
3. Restart `npm run dev`; Next.js reads `.env.local` only at start.
4. Check it: `curl -s http://localhost:3000/api/catalog/modules | head -c 120` should show `"source":"http"`.

To go back, remove those lines or set `CATALOG_SOURCE=static`, then restart `npm run dev`.

### HTTP contract

An official endpoint replaces the seed without UI changes if it follows this contract (`HttpCatalogSource`):

- `GET {base}/modules` answers 200 with the envelope `{ "catalog_version": string, "modules": ModuleRecord[] }`, the same shape as the seed file.
- `GET {base}/modules/{id}`, with the id URL-encoded, answers 200 with one bare `ModuleRecord` whose `id` equals the requested id.
- An unknown id answers 404; the app then answers 404 as well.
- When `CATALOG_API_KEY` is set, every request carries `Authorization: Bearer <key>`; without a key no `Authorization` header is sent.
- Requests send `Accept: application/json` and time out after 15 seconds.
- Network errors and timeouts become "Katalog servisine ulaşılamadı", any other non-200 status becomes "Katalog servisi hata verdi (<status>)", and a body that fails validation becomes "Katalog servisi beklenmeyen bir yanıt verdi".
- Every record is validated with the same zod schema as the seed (`src/lib/catalog/schema.ts`).
- Every field must be present; a value the datasheet does not give is `null`, never a typical value.
- Numbers are finite, and every number except the temperature coefficients must be positive when set.

`e2e/fixtures/catalog-fixture.json` shows the format with fake records (brand `TEST-FIXTURE`, not real products).

| Field | Type | Unit or values |
| --- | --- | --- |
| `id` | string | Stable identifier, unique in the catalogue. |
| `version` | string | Changes whenever any value of the record changes; designs store it with the id. |
| `record_level` | `"series"` or `"variant"` | `series`: a whole product line with a power range; `variant`: one power class. |
| `brand` | string | As shown in the app. |
| `series`, `model` | string or null | As printed. |
| `technology` | `"topcon"`, `"perc"` or `"unknown"` | |
| `cell_count` | integer or null | Cells (or half-cells) as printed. |
| `bifacial` | boolean or null | |
| `bifaciality` | number or null | Percent (80, not 0.8). |
| `p_max_w` | number or null | W at STC; null on series records. |
| `p_max_range_w` | `{ "min": number, "max": number }` or null | W, the published power range. |
| `v_mp`, `v_oc` | number or null | V. |
| `i_mp`, `i_sc` | number or null | A. |
| `efficiency_pct` | number or null | %, for this power class; null on series records. |
| `efficiency_max_pct` | number or null | %, the highest efficiency in the series. |
| `gamma_pmax_pct_per_c`, `beta_voc_pct_per_c`, `alpha_isc_pct_per_c` | number or null | %/°C (power and voltage negative, current positive). |
| `noct_c` | number or null | °C. |
| `length_mm`, `width_mm`, `thickness_mm` | number or null | mm; `length_mm` is the long side. |
| `weight_kg` | number or null | kg. |
| `max_system_voltage_v` | number or null | V. |
| `frame_color` | string or null | As printed. |
| `power_tolerance` | string or null | As printed, for example `"0~+5W"`. |
| `warranty_product_years`, `warranty_performance_years` | number or null | Years. |
| `degradation_year1_pct`, `degradation_yearly_pct` | number or null | %, first year and per later year. |
| `datasheet_url` | URL or null | The published datasheet document; in today's seed it is the cover page image, the only part the site publishes. |
| `source_url` | URL | The page the values were read from. |
| `fetched_at` | ISO 8601 date-time in UTC | For example `2026-10-01T00:00:00Z`. |
| `verified` | boolean | See "Verified flag" below. |
| `notes` | string[] | Anything unusual about the record. |

### Refreshing and validating the seed

`npm run catalog:validate` checks the seed against the schema and the sanity rules in `src/lib/catalog/sanity.ts`, and lists the null fields of every record.
`npm run catalog:validate -- path/to/file.json` checks another file, for example an export from the official endpoint.
It exits with status 1 on schema or sanity errors; null fields are reported, not failed.
The refresh steps (re-fetch the listing and covers, transcribe twice, validate, bump `catalog_version` and the record versions) and the source manifest are in `data/catalog/README.md`.

### Verified flag

`verified: true` means a named person has checked the record against the manufacturer's full datasheet; a transcription, script or AI tool never sets it.
A second person reviews that change, and any later change to a value sets `verified` back to `false` and bumps `version`.
The full policy is in `data/catalog/README.md`.
Catalogue views always show the attribution line "Ürün verileri üreticinin yayınladığı teknik dokümanlardan alınmıştır; doğrulanana kadar bilgi amaçlıdır."

## Known limits (deliberate for a prototype)

- Until a catalogue record has length, width and rated power, designs pack with a placeholder module (590 W, 2.278 x 1.134 m, shown as "Yer tutucu modül"); the current seed has no such record.
  Real datasheet values must come from the manufacturer's full datasheet and be checked by a second person before `verified` is set.
- No shading calculation yet; obstacle height is stored but unused. Rack rows are spaced by the limit-angle rule only.
- One uniform setback per face (the plan wants per-edge setbacks), no undo/redo, no strings or inverters, no finance, no PDF.
- Esri imagery without a key is fine for local use only; production needs a licensed provider (MapTiler or Mapbox) behind an adapter, as `docs/08-data-sources.md` says.
- Desktop-first layout; on a phone the map and panel stack but drawing is not tuned for touch.
- The route caches and throttles live in one server process; a deployment with several instances needs a shared cache and limiter (for example Vercel KV or Upstash) or a self-hosted geocoder.

## Notes for the real build

- MapLibre 6 resolves its worker relative to its own module URL, which breaks under Next.js bundling.
  `scripts/copy-maplibre-worker.mjs` copies the worker into `public/maplibre/` before `dev` and `build`, and `MapCanvas` calls `setWorkerUrl()`.
- The local metric frame uses the same Transverse Mercator definition as the plan's server-side `LocalCRS`, through proj4js, so client and server lengths agree.
- `vitest.config.ts` maps the `@/` alias to `src/` and leaves `e2e/` to Playwright; the two proxy routes still import `src/lib/server/upstream.ts` by relative path, which works either way.
- The Geist font loads its `latin-ext` subset; without it Turkish letters (ş, ğ, ı, İ) fall back to another font, which also matters for the proposal PDF later.
