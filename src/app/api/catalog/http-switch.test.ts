/**
 * The static -> HTTP switch is configuration only: with CATALOG_SOURCE=http and a base URL, the
 * unchanged route handlers read the real mock endpoint (scripts/mock-catalog-server.mjs) over
 * real HTTP. No fetch is mocked here, and the API key must never reach a response body.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogFileSchema, catalogResponseSchema, moduleResponseSchema } from "@/lib/catalog/schema";
import { GET as getOne } from "./modules/[id]/route";
import { GET as getList } from "./modules/route";

// Fake test data (brand TEST-FIXTURE), never Kıvanç data.
const FIXTURE_PATH = fileURLToPath(new URL("../../../../e2e/fixtures/catalog-fixture.json", import.meta.url));
const MOCK_SERVER = fileURLToPath(new URL("../../../../scripts/mock-catalog-server.mjs", import.meta.url));
const SECRET = "sk-test-http-switch-0123456789";

let child: ChildProcess | null = null;
let baseUrl = "";

/** Starts the mock on a free port with the fixture and a required key; resolves with its URL. */
function startMock(): Promise<{ proc: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [MOCK_SERVER], {
      env: { ...process.env, MOCK_CATALOG_PORT: "0", MOCK_CATALOG_FILE: FIXTURE_PATH, MOCK_CATALOG_KEY: SECRET, MOCK_CATALOG_FAIL: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`mock server did not start: ${out}`));
    }, 5000);
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const port = /http:\/\/localhost:(\d+)/.exec(out)?.[1];
      if (port) {
        clearTimeout(timer);
        resolve({ proc, url: `http://127.0.0.1:${port}` });
      }
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

beforeAll(async () => {
  const started = await startMock();
  child = started.proc;
  baseUrl = started.url;
});
afterAll(async () => {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
});

beforeEach(() => {
  vi.stubEnv("CATALOG_SOURCE", "http");
  vi.stubEnv("CATALOG_API_BASE_URL", `${baseUrl}/`);
  vi.stubEnv("CATALOG_API_KEY", SECRET);
  vi.stubEnv("CATALOG_SEED_PATH", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const one = (id: string) => getOne(new Request(`http://localhost/api/catalog/modules/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) });

describe("catalogue routes with CATALOG_SOURCE=http against the mock endpoint", () => {
  it("serve the fixture with source http, without the key in the body", async () => {
    const fixture = catalogFileSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, "utf8")));
    const res = await getList();
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(SECRET);
    const body = catalogResponseSchema.parse(JSON.parse(raw));
    expect(body.source).toBe("http");
    expect(body.catalog_version).toBe(fixture.catalog_version);
    expect(body.modules).toEqual(fixture.modules);
  });

  it("serve one record and 404 for an unknown id, without the key in either body", async () => {
    const res = await one("fixture-topcon-450");
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(SECRET);
    expect(moduleResponseSchema.parse(JSON.parse(raw)).module.p_max_w).toBe(450);

    const missing = await one("does-not-exist");
    expect(missing.status).toBe(404);
    const missingRaw = await missing.text();
    expect(missingRaw).not.toContain(SECRET);
    expect(JSON.parse(missingRaw)).toEqual({ error: "Panel bulunamadı" });
  });

  it("answer 502 with a safe message when the key is wrong or missing", async () => {
    vi.stubEnv("CATALOG_API_KEY", `${SECRET}-wrong`);
    const wrong = await getList();
    expect(wrong.status).toBe(502);
    const wrongRaw = await wrong.text();
    expect(wrongRaw).not.toContain(SECRET);
    expect(JSON.parse(wrongRaw)).toEqual({ error: "Katalog servisi hata verdi (401)" });

    vi.stubEnv("CATALOG_API_KEY", "");
    const none = await one("fixture-topcon-450");
    expect(none.status).toBe(502);
    expect(await none.json()).toEqual({ error: "Katalog servisi hata verdi (401)" });
  });

  it("switch back to the static seed by configuration alone", async () => {
    vi.stubEnv("CATALOG_SOURCE", "static");
    vi.stubEnv("CATALOG_SEED_PATH", FIXTURE_PATH);
    const body = catalogResponseSchema.parse(await (await getList()).json());
    expect(body.source).toBe("static");
    expect(body.modules).toHaveLength(4);
  });
});
