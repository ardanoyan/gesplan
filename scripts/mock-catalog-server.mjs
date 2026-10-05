/**
 * Local stand-in for the official catalogue endpoint, speaking the same contract the app's
 * HttpCatalogSource expects (README "Katalog"):
 *   GET /modules      -> { catalog_version, modules }
 *   GET /modules/:id  -> one bare record, 404 when unknown
 *
 * Env: MOCK_CATALOG_PORT (default 4010, 0 picks a free port), MOCK_CATALOG_FILE (default the
 * seed), MOCK_CATALOG_KEY (when set, requests need "Authorization: Bearer <key>"),
 * MOCK_CATALOG_FAIL=1 (every request answers 500, to try the error path).
 * The file is re-read on every request, so edits show up without a restart.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const port = Number(process.env.MOCK_CATALOG_PORT ?? 4010);
const file = path.resolve(process.cwd(), process.env.MOCK_CATALOG_FILE || "data/catalog/kivanc-modules.json");
const key = process.env.MOCK_CATALOG_KEY || "";
const fail = process.env.MOCK_CATALOG_FAIL === "1";

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  console.log(`${req.method} ${pathname}`);
  if (fail) return send(res, 500, { error: "MOCK_CATALOG_FAIL=1" });
  if (key && req.headers.authorization !== `Bearer ${key}`) return send(res, 401, { error: "unauthorized" });
  if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });

  let catalog;
  try {
    catalog = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    console.error(`cannot read ${file}: ${e instanceof Error ? e.message : e}`);
    return send(res, 500, { error: "catalogue file unreadable" });
  }

  if (pathname === "/modules") return send(res, 200, catalog);
  const match = /^\/modules\/([^/]+)$/.exec(pathname);
  if (match) {
    let id;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      return send(res, 404, { error: "not found" });
    }
    const record = Array.isArray(catalog?.modules) ? catalog.modules.find((m) => m?.id === id) : undefined;
    return record ? send(res, 200, record) : send(res, 404, { error: "not found" });
  }
  return send(res, 404, { error: "not found" });
});

server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  const actual = typeof addr === "object" && addr ? addr.port : port;
  const notes = [key ? "auth on" : "", fail ? "failing with 500" : ""].filter(Boolean).join(", ");
  console.log(`Mock catalogue at http://localhost:${actual} serving ${path.relative(process.cwd(), file) || file}${notes ? ` (${notes})` : ""}`);
});
