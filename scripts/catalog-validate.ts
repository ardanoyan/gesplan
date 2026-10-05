/**
 * Checks a catalogue file against the schema and the sanity rules, and lists what each record
 * is missing. Null fields are reported, not failed: an unpublished value must stay null.
 *
 *   npm run catalog:validate                       # data/catalog/kivanc-modules.json
 *   npm run catalog:validate -- path/to/file.json
 *
 * Runs on Node's built-in type stripping, hence the explicit .ts import extensions.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { catalogFileSchema } from "../src/lib/catalog/schema.ts";
import { catalogProblems, nullFields } from "../src/lib/catalog/sanity.ts";

const file = path.resolve(process.cwd(), process.argv[2] ?? "data/catalog/kivanc-modules.json");

async function main(): Promise<number> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    console.error(`HATA: ${file} okunamadı veya geçerli JSON değil: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const parsed = catalogFileSchema.safeParse(json);
  if (!parsed.success) {
    console.error(`HATA: ${file} şemaya uymuyor:`);
    for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".") || "(kök)"}: ${issue.message}`);
    return 1;
  }

  const { catalog_version, modules } = parsed.data;
  console.log(`${path.relative(process.cwd(), file)}: catalog_version ${catalog_version}, ${modules.length} kayıt`);
  for (const m of modules) {
    const nulls = nullFields(m);
    console.log(`- ${m.id}  ${m.record_level}  verified=${m.verified}`);
    console.log(`    boş (${nulls.length}): ${nulls.length > 0 ? nulls.join(", ") : "-"}`);
  }
  // Same rule as isUsable in src/lib/catalog/select.ts, kept local so this script needs no bundler.
  const usable = modules.filter((m) => m.length_mm !== null && m.width_mm !== null && m.p_max_w !== null);
  console.log(`Yerleşimde kullanılabilir (boy, en ve güç dolu): ${usable.length}/${modules.length}`);
  const unverified = modules.filter((m) => !m.verified).length;
  if (unverified > 0) console.log(`Doğrulanmamış kayıt: ${unverified}/${modules.length}`);

  const problems = catalogProblems(parsed.data);
  if (problems.length > 0) {
    console.error(`HATA: ${problems.length} tutarlılık sorunu:`);
    for (const p of problems) console.error(`  ${p}`);
    return 1;
  }
  console.log("Şema ve tutarlılık kontrolleri geçti.");
  return 0;
}

process.exitCode = await main();
