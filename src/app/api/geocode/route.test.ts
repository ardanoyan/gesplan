import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROWS = [{ display_name: "Of, Trabzon, Türkiye", lat: "40.9453", lon: "40.2669", boundingbox: ["40.9", "41.0", "40.2", "40.3"] }];

const fetchMock = vi.fn<typeof fetch>();
let GET: (request: Request) => Promise<Response>;

beforeEach(async () => {
  // fresh module state (cache and request spacing) for every test
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  ({ GET } = await import("./route"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const call = (q: string) => GET(new Request(`http://localhost/api/geocode?${new URLSearchParams({ q })}`));
const reply = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("GET /api/geocode", () => {
  it("accepts a two-letter place name and rejects a single letter", async () => {
    const short = await call("O");
    expect(short.status).toBe(400);
    expect((await short.json()).error).toBe("Arama en az 2 karakter olmalı");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(reply(ROWS));
    const res = await call("Of");
    expect(res.status).toBe(200);
    expect((await res.json()).results).toEqual([
      { name: "Of, Trabzon, Türkiye", lat: 40.9453, lon: 40.2669, bbox: [40.9, 41, 40.2, 40.3] },
    ]);
  });

  it("passes on the reason from an error answer", async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: { code: 400, message: "Nothing to search for." } }, 400));
    expect((await (await call("Ankara")).json()).error).toBe("Adres servisi hata verdi (400): Nothing to search for.");
  });

  it("reports a malformed 200 as an unexpected answer", async () => {
    fetchMock.mockResolvedValueOnce(reply("<html>maintenance</html>"));
    const res = await call("Ankara");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Adres servisi beklenmeyen bir yanıt verdi");
  });

  it("says unreachable only for network errors", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await (await call("Ankara")).json()).error).toBe("Adres servisine ulaşılamadı");
  });

  it("spaces Nominatim calls at least 1.1 s apart and serves repeats from the cache", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => reply(ROWS));
    const first = call("Rize");
    const second = call("Artvin");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1099);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await Promise.all([first, second]);
    await call("rize");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
