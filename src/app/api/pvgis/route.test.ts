import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MONTHLY = [60, 80, 120, 150, 180, 190, 200, 190, 150, 110, 70, 50];
const PVGIS_OK = {
  inputs: { meteo_data: { radiation_db: "PVGIS-SARAH3" } },
  outputs: { totals: { fixed: { E_y: 1550 } }, monthly: { fixed: MONTHLY.map((E_m, i) => ({ month: i + 1, E_m })) } },
};

const fetchMock = vi.fn<typeof fetch>();
let GET: (request: Request) => Promise<Response>;

beforeEach(async () => {
  // fresh module state (cache and in-flight limit) for every test
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  ({ GET } = await import("./route"));
});
afterEach(() => vi.unstubAllGlobals());

const call = (params: Record<string, string>) =>
  GET(new Request(`http://localhost/api/pvgis?${new URLSearchParams({ lat: "39.93", lon: "32.85", tilt: "30", azimuth: "180", ...params })}`));
const reply = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("GET /api/pvgis", () => {
  it("asks PVGIS for 1 kWp and scales the energy by kwp, including above 10 MWp", async () => {
    fetchMock.mockResolvedValue(reply(PVGIS_OK));
    const small = await call({ kwp: "5000" });
    expect(small.status).toBe(200);
    const a = await small.json();
    expect(a.annualKwh).toBe(7_750_000);
    expect(a.monthlyKwh).toEqual(MONTHLY.map((m) => m * 5000));
    expect(a.specificKwhPerKwp).toBe(1550);
    expect(a.radiationDb).toBe("PVGIS-SARAH3");
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("peakpower")).toBe("1");

    const large = await call({ kwp: "20000" });
    expect(large.status).toBe(200);
    const b = await large.json();
    expect(b.annualKwh).toBe(31_000_000);
    expect(b.monthlyKwh[6]).toBe(200 * 20000);
    // same location and orientation: served from the per-kWp cache
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects kwp outside 0 to 1,000,000 with a clear message", async () => {
    for (const kwp of ["0", "-5", "1000001"]) {
      const res = await call({ kwp });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("1.000.000 kWp");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes on the reason PVGIS gives with a 400", async () => {
    fetchMock.mockResolvedValue(reply({ message: "Location over the sea. Please, select another location", status: 400 }, 400));
    const res = await call({ kwp: "10" });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("PVGIS bu konum için hesap yapamadı: Location over the sea. Please, select another location");
    expect(body.detail).toContain("Location over the sea");
  });

  it("keeps the status for a non-JSON error page", async () => {
    fetchMock.mockResolvedValue(reply("<html>Service Unavailable</html>", 503));
    const body = await (await call({ kwp: "10" })).json();
    expect(body.error).toBe("PVGIS hata verdi (503)");
  });

  it("reports a malformed 200 as an unexpected answer, not as unreachable", async () => {
    for (const bad of ["<html>maintenance</html>", { foo: 1 }, { outputs: { totals: { fixed: { E_y: 1 } } } }]) {
      fetchMock.mockResolvedValueOnce(reply(bad));
      const res = await call({ kwp: "10" });
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe("PVGIS beklenmeyen bir yanıt verdi");
    }
  });

  it("says unreachable only for network errors and timeouts", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const body = await (await call({ kwp: "10" })).json();
    expect(body.error).toBe("PVGIS'e ulaşılamadı");
  });

  it("keeps at most two PVGIS requests in flight", async () => {
    const pending: ((r: Response) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    const calls = ["36.9", "37.9", "38.9"].map((lat) => call({ lat, kwp: "10" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[0](reply(PVGIS_OK));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    pending[1](reply(PVGIS_OK));
    pending[2](reply(PVGIS_OK));
    for (const res of await Promise.all(calls)) expect(res.status).toBe(200);
  });
});
