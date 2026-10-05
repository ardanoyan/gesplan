"use client";

/**
 * Client hooks for the catalogue. They only ever talk to this app's own route handlers, so the
 * active source (static seed or HTTP endpoint) and any API key stay on the server.
 */
import { useQuery } from "@tanstack/react-query";
import { catalogResponseSchema, moduleResponseSchema, type CatalogResponse, type ModuleRecord } from "./schema";

async function getJson(url: string, signal: AbortSignal): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error("Sunucuya ulaşılamadı; bağlantıyı kontrol edip tekrar deneyin.");
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (res.status === 404) return { status: 404, body };
  if (!res.ok) {
    const msg = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
    throw new Error(msg ?? `Katalog yüklenemedi (${res.status}).`);
  }
  if (body === undefined) throw new Error("Sunucudan beklenmeyen bir yanıt geldi.");
  return { status: res.status, body };
}

export function useModules() {
  return useQuery({
    queryKey: ["catalog", "modules"],
    queryFn: async ({ signal }): Promise<CatalogResponse> => {
      const { body } = await getJson("/api/catalog/modules", signal);
      const parsed = catalogResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("Katalog verisi beklenen biçimde değil.");
      return parsed.data;
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function useModule(id: string | null) {
  return useQuery({
    queryKey: ["catalog", "module", id],
    enabled: id !== null,
    queryFn: async ({ signal }): Promise<ModuleRecord | null> => {
      const { status, body } = await getJson(`/api/catalog/modules/${encodeURIComponent(id ?? "")}`, signal);
      if (status === 404) return null;
      const parsed = moduleResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("Panel verisi beklenen biçimde değil.");
      return parsed.data.module;
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
