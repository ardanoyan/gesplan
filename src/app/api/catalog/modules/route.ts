/**
 * GET /api/catalog/modules: the whole catalogue from the configured source (static seed or HTTP
 * endpoint), as catalogResponseSchema. The source and its API key stay on the server.
 */
import type { CatalogResponse } from "@/lib/catalog/schema";
import { catalogErrorResponse, getCatalogSource } from "@/lib/catalog/source";

// The seed or the upstream may change at any time; never serve a build-time snapshot.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const source = getCatalogSource();
    const { catalog_version, modules } = await source.getCatalog();
    const body: CatalogResponse = { catalog_version, source: source.kind, modules };
    return Response.json(body);
  } catch (e) {
    return catalogErrorResponse(e);
  }
}
