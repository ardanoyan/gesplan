// Copies MapLibre's worker and its shared chunk into public/ so the browser can load them.
// MapLibre 6 resolves the worker relative to its own module URL, which does not survive
// bundling; MapCanvas points setWorkerUrl() at the copied file instead. Runs before dev/build.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "maplibre-gl", "dist");
const dest = join(root, "public", "maplibre");
mkdirSync(dest, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(src, file), join(dest, file));
}
console.log("maplibre worker copied to public/maplibre");
