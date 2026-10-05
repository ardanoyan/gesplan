import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogFileSchema, moduleResponseSchema } from "@/lib/catalog/schema";
import { GET, dynamic } from "./route";

// Fake test data (brand TEST-FIXTURE), never Kıvanç data.
const FIXTURE_PATH = fileURLToPath(new URL("../../../../../../e2e/fixtures/catalog-fixture.json", import.meta.url));
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

const call = (id: string) =>
  GET(new Request(`http://localhost/api/catalog/modules/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) });
const useHttp = () => {
  vi.stubEnv("CATALOG_SOURCE", "http");
  vi.stubEnv("CATALOG_API_BASE_URL", "https://catalog.example.test/v1");
  vi.stubEnv("CATALOG_API_KEY", SECRET);
};

describe("GET /api/catalog/modules/[id]", () => {
  it("is never prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("answers { module } for a known id", async () => {
    const res = await call("fixture-perc-500");
    expect(res.status).toBe(200);
    const { module } = moduleResponseSchema.parse(await res.json());
    expect(module.id).toBe("fixture-perc-500");
    expect(module.p_max_w).toBe(500);
  });

  it("answers 404 for an unknown or oversized id", async () => {
    const res = await call("does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Panel bulunamadı" });
    expect((await call("x".repeat(500))).status).toBe(404);
  });

  it("reads one record from the HTTP source", async () => {
    useHttp();
    const file = catalogFileSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, "utf8")));
    fetchMock.mockResolvedValueOnce(Response.json(file.modules[1]));
    const res = await call("fixture-topcon-450");
    expect(res.status).toBe(200);
    expect(moduleResponseSchema.parse(await res.json()).module.id).toBe("fixture-topcon-450");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://catalog.example.test/v1/modules/fixture-topcon-450");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${SECRET}`);
  });

  it("passes the upstream 404 on as 404", async () => {
    useHttp();
    fetchMock.mockResolvedValueOnce(Response.json({ error: "not found" }, { status: 404 }));
    const res = await call("gone/123");
    expect(res.status).toBe(404);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://catalog.example.test/v1/modules/gone%2F123");
  });

  it("answers 502 when the HTTP source is unreachable", async () => {
    useHttp();
    fetchMock.mockRejectedValueOnce(new TypeError(`connect ECONNREFUSED (Bearer ${SECRET})`));
    const res = await call("fixture-topcon-450");
    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(raw).not.toContain(SECRET);
    expect(JSON.parse(raw)).toEqual({ error: "Katalog servisine ulaşılamadı" });
  });
});
