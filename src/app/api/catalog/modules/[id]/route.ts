/**
 * GET /api/catalog/modules/[id]: one record as { module }, or 404 when the source has no such id.
 */
import { catalogErrorResponse, getCatalogSource } from "@/lib/catalog/source";

export const dynamic = "force-dynamic";

const MAX_ID_LENGTH = 200;

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const notFound = () => Response.json({ error: "Panel bulunamadı" }, { status: 404 });
  if (!id || id.length > MAX_ID_LENGTH) return notFound();
  try {
    const record = await getCatalogSource().getModule(id);
    return record ? Response.json({ module: record }) : notFound();
  } catch (e) {
    return catalogErrorResponse(e);
  }
}
