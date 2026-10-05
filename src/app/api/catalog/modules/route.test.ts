import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogResponseSchema } from "@/lib/catalog/schema";
import { GET, dynamic } from "./route";

// Fake test data (brand TEST-FIXTURE), never Kıvanç data.
const FIXTURE_PATH = fileURLToPath(new URL("../../../../../e2e/fixtures/catalog-fixture.json", import.meta.url));
const SECRET = "sk-test-route-0123456789";
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("CATALOG_SOURCE", "");
  vi.stubEnv("CATALOG_SEED_PATH", FIXTURE_PATH);
  vi.stubEnv("CATALOG_API_BASE_URL", "");
  vi.stubEnv("CATALOG_API_KEY", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const useHttp = () => {
  vi.stubEnv("CATALOG_SOURCE", "http");
  vi.stubEnv("CATALOG_API_BASE_URL", "https://catalog.example.test/v1/");
  vi.stubEnv("CATALOG_API_KEY", SECRET);
};

describe("GET /api/catalog/modules", () => {
  it("is never prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("serves the static seed named by CATALOG_SEED_PATH", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = catalogResponseSchema.parse(await res.json());
    expect(body.source).toBe("static");
    expect(body.catalog_version).toBe("fixture-2026-10-01");
    expect(body.modules.map((m) => m.id)).toEqual(["fixture-topcon-600", "fixture-topcon-450", "fixture-perc-500", "fixture-series-only"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 with a safe message when the seed is missing", async () => {
    vi.stubEnv("CATALOG_SEED_PATH", "data/catalog/does-not-exist.json");
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Katalog dosyası bulunamadı." });
  });

  it("reads the HTTP source with the key, without sending the key to the client", async () => {
    useHttp();
    const text = await readFile(FIXTURE_PATH, "utf8");
    fetchMock.mockResolvedValueOnce(new Response(text, { status: 200 }));
    const res = await GET();
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(SECRET);
    const body = catalogResponseSchema.parse(JSON.parse(raw));
    expect(body.source).toBe("http");
    expect(body.modules).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://catalog.example.test/v1/modules");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${SECRET}`);
  });

  it("passes an upstream failure on as 502", async () => {
    useHttp();
    fetchMock.mockResolvedValueOnce(new Response(`{"error":"key ${SECRET} rejected"}`, { status: 500 }));
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Katalog servisi hata verdi (500)" });
  });

  it("reports a misconfigured source as 502", async () => {
    vi.stubEnv("CATALOG_SOURCE", "ftp");
    const res = await GET();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('CATALOG_SOURCE "ftp" desteklenmiyor');

    vi.stubEnv("CATALOG_SOURCE", "http");
    const missingUrl = await GET();
    expect(missingUrl.status).toBe(502);
    expect((await missingUrl.json()).error).toContain("CATALOG_API_BASE_URL tanımlı değil");
  });
});
