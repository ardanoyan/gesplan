/**
 * Where the module catalogue comes from. Server-only: the route handlers under
 * /api/catalog read through a CatalogSource, so the client never sees the source, its address
 * or its API key.
 *
 * - StaticCatalogSource reads the seed JSON in the repo. It is the development source and the
 *   default; its records are transcribed from public documents and unverified.
 * - HttpCatalogSource reads an HTTP endpoint with the same JSON contract (README "Katalog"),
 *   so the official catalogue can replace the seed without touching the UI.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { catalogFileSchema, moduleRecordSchema, type CatalogFile, type ModuleRecord } from "./schema";

if (typeof window !== "undefined") {
  throw new Error("src/lib/catalog/source.ts yalnızca sunucuda kullanılabilir.");
}

export interface CatalogSource {
  readonly kind: "static" | "http";
  /** The whole envelope in one read; the list route needs the version and the records together. */
  getCatalog(): Promise<CatalogFile>;
  listModules(): Promise<ModuleRecord[]>;
  /** Null when no record has this id. */
  getModule(id: string): Promise<ModuleRecord | null>;
  catalogVersion(): Promise<string>;
}

/**
 * A failure the user may see as is. The message is Turkish and never contains the API key,
 * the upstream response body or a server file path; details stay in `cause` for server logs.
 */
export class CatalogError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CatalogError";
  }
}

export const DEFAULT_SEED_PATH = path.join("data", "catalog", "kivanc-modules.json");

/** Development source: the seed file, re-read whenever it changes on disk. */
export class StaticCatalogSource implements CatalogSource {
  readonly kind = "static";
  readonly filePath: string;
  private cached: { mtimeMs: number; size: number; file: CatalogFile } | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async getCatalog(): Promise<CatalogFile> {
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(this.filePath);
    } catch (e) {
      throw new CatalogError("Katalog dosyası bulunamadı.", { cause: e });
    }
    const hit = this.cached;
    if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.file;

    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (e) {
      throw new CatalogError("Katalog dosyası okunamadı.", { cause: e });
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new CatalogError("Katalog dosyası geçerli JSON değil.", { cause: e });
    }
    const parsed = catalogFileSchema.safeParse(json);
    if (!parsed.success) {
      throw new CatalogError("Katalog dosyası beklenen biçimde değil; npm run catalog:validate ile kontrol edin.", {
        cause: parsed.error,
      });
    }
    this.cached = { mtimeMs: info.mtimeMs, size: info.size, file: parsed.data };
    return parsed.data;
  }

  async listModules(): Promise<ModuleRecord[]> {
    return (await this.getCatalog()).modules;
  }

  async getModule(id: string): Promise<ModuleRecord | null> {
    return (await this.getCatalog()).modules.find((m) => m.id === id) ?? null;
  }

  async catalogVersion(): Promise<string> {
    return (await this.getCatalog()).catalog_version;
  }
}

export interface HttpCatalogOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const UNREACHABLE = "Katalog servisine ulaşılamadı";
const UNEXPECTED = "Katalog servisi beklenmeyen bir yanıt verdi";

/**
 * Official catalogue over HTTP. GET {base}/modules answers the catalogue envelope,
 * GET {base}/modules/{id} answers one bare record or 404.
 */
export class HttpCatalogSource implements CatalogSource {
  readonly kind = "http";
  readonly baseUrl: string;
  // A true private field: never enumerable, so logging or serialising the source cannot leak it.
  readonly #apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HttpCatalogOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.#apiKey = opts.apiKey || undefined;
    // Look the global up per call so a replaced fetch (tests, instrumentation) is honoured.
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** Status and parsed JSON body; 404 is returned to the caller, other failures throw. */
  private async request(pathname: string): Promise<{ status: 404 } | { status: 200; body: unknown }> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.#apiKey) headers.Authorization = `Bearer ${this.#apiKey}`;
    const controller = new AbortController();
    // The timer also covers reading the body, so a stalled stream cannot hang the route.
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${pathname}`, { headers, signal: controller.signal, cache: "no-store" });
      } catch (e) {
        throw new CatalogError(UNREACHABLE, { cause: e });
      }
      if (res.status === 404) return { status: 404 };
      if (!res.ok) throw new CatalogError(`Katalog servisi hata verdi (${res.status})`);
      let text: string;
      try {
        text = await res.text();
      } catch (e) {
        throw new CatalogError(UNREACHABLE, { cause: e });
      }
      try {
        return { status: 200, body: JSON.parse(text) };
      } catch (e) {
        throw new CatalogError(UNEXPECTED, { cause: e });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async getCatalog(): Promise<CatalogFile> {
    const res = await this.request("/modules");
    if (res.status === 404) throw new CatalogError("Katalog servisi hata verdi (404)");
    const parsed = catalogFileSchema.safeParse(res.body);
    if (!parsed.success) throw new CatalogError(UNEXPECTED, { cause: parsed.error });
    return parsed.data;
  }

  async listModules(): Promise<ModuleRecord[]> {
    return (await this.getCatalog()).modules;
  }

  async getModule(id: string): Promise<ModuleRecord | null> {
    const res = await this.request(`/modules/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    const parsed = moduleRecordSchema.safeParse(res.body);
    // A record for another id would silently pack the wrong module.
    if (!parsed.success || parsed.data.id !== id) throw new CatalogError(UNEXPECTED, { cause: parsed.error });
    return parsed.data;
  }

  async catalogVersion(): Promise<string> {
    return (await this.getCatalog()).catalog_version;
  }
}

export type CatalogEnv = Record<string, string | undefined>;

// One static source per path, so its mtime cache survives across requests.
const staticSources = new Map<string, StaticCatalogSource>();

/**
 * The source the environment asks for. CATALOG_SOURCE is "static" (default) or "http";
 * http needs CATALOG_API_BASE_URL and takes an optional CATALOG_API_KEY. CATALOG_SEED_PATH
 * overrides the seed file for the static source (relative paths resolve against the cwd).
 */
export function getCatalogSource(env: CatalogEnv = process.env): CatalogSource {
  const kind = env.CATALOG_SOURCE?.trim() || "static";
  if (kind === "static") {
    // The default path is spelled out so Next traces only data/catalog into the server output; a
    // dynamic path would make it trace (and deploy) the whole project. The override is for tests
    // and local experiments, so it is opted out of tracing.
    const override = env.CATALOG_SEED_PATH?.trim();
    const filePath = override
      ? path.resolve(/*turbopackIgnore: true*/ process.cwd(), override)
      : path.join(process.cwd(), "data", "catalog", "kivanc-modules.json");
    let source = staticSources.get(filePath);
    if (!source) {
      source = new StaticCatalogSource(filePath);
      staticSources.set(filePath, source);
    }
    return source;
  }
  if (kind === "http") {
    const baseUrl = env.CATALOG_API_BASE_URL?.trim();
    if (!baseUrl) throw new CatalogError("CATALOG_API_BASE_URL tanımlı değil; HTTP katalog kaynağı kullanılamıyor.");
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new CatalogError("CATALOG_API_BASE_URL geçerli bir adres değil.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new CatalogError("CATALOG_API_BASE_URL http veya https adresi olmalı.");
    }
    return new HttpCatalogSource({ baseUrl, apiKey: env.CATALOG_API_KEY?.trim() || undefined });
  }
  throw new CatalogError(`CATALOG_SOURCE "${kind.slice(0, 40)}" desteklenmiyor; "static" veya "http" kullanın.`);
}

/** Route handler answer for a failed catalogue read: 502 with a message safe to show. */
export function catalogErrorResponse(e: unknown): Response {
  if (e instanceof CatalogError) {
    const cause = e.cause instanceof Error ? e.cause.message : "";
    console.warn("[catalog]", e.message, cause);
    return Response.json({ error: e.message }, { status: 502 });
  }
  console.error("[catalog]", e);
  return Response.json({ error: "Katalog yüklenemedi." }, { status: 502 });
}
