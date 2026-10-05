import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { catalogFileSchema } from "./schema";
import { CatalogError, HttpCatalogSource, StaticCatalogSource, getCatalogSource } from "./source";

// Fake test data (brand TEST-FIXTURE), never Kıvanç data.
const FIXTURE_PATH = fileURLToPath(new URL("../../../e2e/fixtures/catalog-fixture.json", import.meta.url));
const MOCK_SERVER = fileURLToPath(new URL("../../../scripts/mock-catalog-server.mjs", import.meta.url));
const SECRET = "sk-test-0123456789";

let fixtureText = "";
let tmp = "";
beforeAll(async () => {
  fixtureText = await readFile(FIXTURE_PATH, "utf8");
  tmp = await mkdtemp(path.join(os.tmpdir(), "gesplan-catalog-"));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const fixture = () => catalogFileSchema.parse(JSON.parse(fixtureText));
const reply = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Runs the promise and returns the CatalogError it rejects with. */
async function catalogError(p: Promise<unknown>): Promise<CatalogError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CatalogError) return e;
    throw e;
  }
  throw new Error("expected a CatalogError");
}

describe("StaticCatalogSource", () => {
  it("serves the fixture file", async () => {
    const src = new StaticCatalogSource(FIXTURE_PATH);
    expect(src.kind).toBe("static");
    expect(await src.catalogVersion()).toBe("fixture-2026-10-01");
    expect((await src.listModules()).map((m) => m.id)).toContain("fixture-perc-500");
    expect((await src.getModule("fixture-perc-500"))?.p_max_w).toBe(500);
    expect((await src.getCatalog()).modules).toHaveLength(4);
  });

  it("answers null for an unknown id", async () => {
    expect(await new StaticCatalogSource(FIXTURE_PATH).getModule("does-not-exist")).toBeNull();
  });

  it("rejects a missing, non-JSON or off-schema file with a CatalogError", async () => {
    const missing = await catalogError(new StaticCatalogSource(path.join(tmp, "missing.json")).listModules());
    expect(missing.message).toBe("Katalog dosyası bulunamadı.");
    expect(missing.message).not.toContain(tmp);

    const notJson = path.join(tmp, "not-json.json");
    await writeFile(notJson, "{ catalog_version: ");
    expect((await catalogError(new StaticCatalogSource(notJson).listModules())).message).toBe("Katalog dosyası geçerli JSON değil.");

    const offSchema = path.join(tmp, "off-schema.json");
    const data = JSON.parse(fixtureText);
    data.modules[0].p_max_w = "600";
    await writeFile(offSchema, JSON.stringify(data));
    const err = await catalogError(new StaticCatalogSource(offSchema).getModule("fixture-topcon-600"));
    expect(err.message).toContain("Katalog dosyası beklenen biçimde değil");
  });

  it("re-reads the file after it changes on disk", async () => {
    const file = path.join(tmp, "changing.json");
    await writeFile(file, fixtureText);
    const src = new StaticCatalogSource(file);
    expect(await src.catalogVersion()).toBe("fixture-2026-10-01");
    const next = { ...JSON.parse(fixtureText), catalog_version: "fixture-2026-10-02-longer" };
    await writeFile(file, JSON.stringify(next));
    expect(await src.catalogVersion()).toBe("fixture-2026-10-02-longer");
  });
});

describe("HttpCatalogSource", () => {
  const fetchMock = vi.fn<typeof fetch>();
  afterEach(() => fetchMock.mockReset());
  const source = (apiKey?: string, timeoutMs?: number) =>
    new HttpCatalogSource({ baseUrl: "https://catalog.example.test/v1/", apiKey, fetchImpl: fetchMock, timeoutMs });
  const headersOf = (call: number) => new Headers(fetchMock.mock.calls[call]?.[1]?.headers);

  it("reads the envelope from {base}/modules", async () => {
    fetchMock.mockImplementation(async () => reply(fixture()));
    const src = source();
    expect(src.kind).toBe("http");
    expect(await src.catalogVersion()).toBe("fixture-2026-10-01");
    expect((await src.listModules()).map((m) => m.id)).toHaveLength(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://catalog.example.test/v1/modules");
  });

  it("reads one bare record from {base}/modules/{id}, with the id encoded", async () => {
    const perc = fixture().modules[2];
    fetchMock.mockResolvedValueOnce(reply(perc));
    expect(await source().getModule("fixture-perc-500")).toEqual(perc);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://catalog.example.test/v1/modules/fixture-perc-500");

    fetchMock.mockResolvedValueOnce(reply({ error: "not found" }, 404));
    expect(await source().getModule("a/b c")).toBeNull();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://catalog.example.test/v1/modules/a%2Fb%20c");
  });

  it("answers null for 404 on one record but fails the list on 404", async () => {
    fetchMock.mockImplementation(async () => reply({ error: "not found" }, 404));
    expect(await source().getModule("missing")).toBeNull();
    expect((await catalogError(source().listModules())).message).toBe("Katalog servisi hata verdi (404)");
  });

  it("reports an error status", async () => {
    fetchMock.mockImplementation(async () => reply({ error: "boom" }, 500));
    expect((await catalogError(source().listModules())).message).toBe("Katalog servisi hata verdi (500)");
    expect((await catalogError(source().getModule("x"))).message).toBe("Katalog servisi hata verdi (500)");
  });

  it("reports an invalid payload as unexpected", async () => {
    const unexpected = "Katalog servisi beklenmeyen bir yanıt verdi";
    fetchMock.mockResolvedValueOnce(reply("<html>maintenance</html>"));
    expect((await catalogError(source().listModules())).message).toBe(unexpected);
    fetchMock.mockResolvedValueOnce(reply({ modules: [] }));
    expect((await catalogError(source().listModules())).message).toBe(unexpected);
    fetchMock.mockResolvedValueOnce(reply({ module: fixture().modules[0] }));
    expect((await catalogError(source().getModule("fixture-topcon-600"))).message).toBe(unexpected);
    // a record for a different id would pack the wrong module
    fetchMock.mockResolvedValueOnce(reply(fixture().modules[1]));
    expect((await catalogError(source().getModule("fixture-topcon-600"))).message).toBe(unexpected);
  });

  it("reports network failures and timeouts as unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await catalogError(source().listModules())).message).toBe("Katalog servisine ulaşılamadı");

    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    expect((await catalogError(source(undefined, 20).listModules())).message).toBe("Katalog servisine ulaşılamadı");
  });

  it("sends the bearer token only when a key is set", async () => {
    fetchMock.mockImplementation(async () => reply(fixture()));
    await source().listModules();
    expect(headersOf(0).has("Authorization")).toBe(false);
    await source("").listModules();
    expect(headersOf(1).has("Authorization")).toBe(false);
    await source(SECRET).listModules();
    expect(headersOf(2).get("Authorization")).toBe(`Bearer ${SECRET}`);
  });

  it("never puts the key in an error message or in the serialised source", async () => {
    const src = source(SECRET);
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed for Bearer ${SECRET}`));
    fetchMock.mockResolvedValueOnce(reply({ error: `bad key ${SECRET}` }, 401));
    fetchMock.mockResolvedValueOnce(reply(`not json ${SECRET}`));
    const messages = [
      (await catalogError(src.listModules())).message,
      (await catalogError(src.listModules())).message,
      (await catalogError(src.getModule("x"))).message,
    ];
    expect(messages).toEqual([
      "Katalog servisine ulaşılamadı",
      "Katalog servisi hata verdi (401)",
      "Katalog servisi beklenmeyen bir yanıt verdi",
    ]);
    expect(JSON.stringify(src)).not.toContain(SECRET);
  });
});

describe("getCatalogSource", () => {
  it("defaults to the static seed under the working directory", () => {
    const src = getCatalogSource({});
    expect(src).toBeInstanceOf(StaticCatalogSource);
    expect((src as StaticCatalogSource).filePath).toBe(path.join(process.cwd(), "data", "catalog", "kivanc-modules.json"));
    expect(getCatalogSource({ CATALOG_SOURCE: " static " })).toBe(src);
  });

  it("takes the seed path from CATALOG_SEED_PATH", async () => {
    const src = getCatalogSource({ CATALOG_SEED_PATH: FIXTURE_PATH });
    expect(src.kind).toBe("static");
    expect(await src.catalogVersion()).toBe("fixture-2026-10-01");
    const rel = getCatalogSource({ CATALOG_SEED_PATH: "e2e/fixtures/catalog-fixture.json" }) as StaticCatalogSource;
    expect(rel.filePath).toBe(FIXTURE_PATH);
  });

  it("builds the HTTP source from CATALOG_API_BASE_URL, tolerating a trailing slash", () => {
    const src = getCatalogSource({ CATALOG_SOURCE: "http", CATALOG_API_BASE_URL: "http://localhost:4010/", CATALOG_API_KEY: SECRET });
    expect(src).toBeInstanceOf(HttpCatalogSource);
    expect((src as HttpCatalogSource).baseUrl).toBe("http://localhost:4010");
  });

  it("refuses an HTTP source without a usable base URL and unknown source kinds", () => {
    expect(() => getCatalogSource({ CATALOG_SOURCE: "http" })).toThrow("CATALOG_API_BASE_URL tanımlı değil");
    expect(() => getCatalogSource({ CATALOG_SOURCE: "http", CATALOG_API_BASE_URL: "localhost:4010" })).toThrow(CatalogError);
    expect(() => getCatalogSource({ CATALOG_SOURCE: "http", CATALOG_API_BASE_URL: "not a url" })).toThrow(
      "CATALOG_API_BASE_URL geçerli bir adres değil.",
    );
    expect(() => getCatalogSource({ CATALOG_SOURCE: "s3" })).toThrow('CATALOG_SOURCE "s3" desteklenmiyor');
  });
});

/** Starts scripts/mock-catalog-server.mjs on a free port and resolves with its base URL. */
function startMock(env: Record<string, string>): Promise<{ child: ChildProcess; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MOCK_SERVER], {
      env: { ...process.env, MOCK_CATALOG_PORT: "0", MOCK_CATALOG_FILE: FIXTURE_PATH, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`mock server did not start: ${out}`));
    }, 5000);
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const port = /http:\/\/localhost:(\d+)/.exec(out)?.[1];
      if (port) {
        clearTimeout(timer);
        resolve({ child, baseUrl: `http://127.0.0.1:${port}` });
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

describe("HttpCatalogSource against scripts/mock-catalog-server.mjs", () => {
  const children: ChildProcess[] = [];
  afterAll(() => {
    for (const c of children) c.kill();
  });

  it("agrees with the mock on the contract, including auth", async () => {
    const { child, baseUrl } = await startMock({ MOCK_CATALOG_KEY: SECRET });
    children.push(child);
    const src = new HttpCatalogSource({ baseUrl: `${baseUrl}/`, apiKey: SECRET });
    expect(await src.catalogVersion()).toBe("fixture-2026-10-01");
    expect((await src.listModules()).map((m) => m.id)).toEqual(fixture().modules.map((m) => m.id));
    expect((await src.getModule("fixture-topcon-450"))?.p_max_w).toBe(450);
    expect(await src.getModule("does-not-exist")).toBeNull();

    const noKey = new HttpCatalogSource({ baseUrl });
    expect((await catalogError(noKey.listModules())).message).toBe("Katalog servisi hata verdi (401)");
  });

  it("surfaces the mock's failure mode as an error status", async () => {
    const { child, baseUrl } = await startMock({ MOCK_CATALOG_FAIL: "1" });
    children.push(child);
    expect((await catalogError(new HttpCatalogSource({ baseUrl }).listModules())).message).toBe(
      "Katalog servisi hata verdi (500)",
    );
  });
});
