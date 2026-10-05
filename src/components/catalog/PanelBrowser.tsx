"use client";

/**
 * The module catalogue: list, search and filters, detail drawer and comparison. One component
 * for both places it appears: the standalone /paneller page ("page", nothing to select into)
 * and the designer's "Panel seçimi" side panel ("designer", with the current roof to compare on).
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useMemo, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import CoachMarks, { type CoachStep } from "@/components/tutorial/CoachMarks";
import { track } from "@/lib/analytics";
import type { DesignSnapshot } from "@/lib/catalog/compare";
import { DEFAULT_FILTERS, applyFilters, filtersToParams, frameColours, parseFilters, type CatalogFilters } from "@/lib/catalog/filters";
import { useModules } from "@/lib/catalog/hooks";
import type { ModuleRecord } from "@/lib/catalog/schema";
import { isUsable, moduleLabel, type ActiveModule } from "@/lib/catalog/select";
import { fmt } from "@/lib/format";
import PanelCard from "./PanelCard";
import PanelCompare from "./PanelCompare";
import PanelDetail from "./PanelDetail";
import { catalogPowerBounds, isDefaultFilters, mergeFilterQuery } from "./filter-state";
import PanelFilters from "./PanelFilters";
import { ATTRIBUTION, COMPARE_LIMIT, COMPARE_LIMIT_TEXT, countLabel } from "./spec-rows";
import { buttonPrimary, buttonSecondary, focusRing } from "./ui";

export type PanelBrowserProps =
  | { mode: "page" }
  | { mode: "designer"; design: DesignSnapshot | null; active: ActiveModule; onSelect(module: ModuleRecord): void };

export const TUTORIAL_STORAGE_KEY = "gesplan-tutorial-panels-v1";

const BASE_STEPS: CoachStep[] = [
  {
    anchor: "list",
    title: "Göz at",
    body: "Katalogdaki paneller burada listelenir. Her kartta güç, verim, boyut ve veri durumu görünür; “Ayrıntılar” tüm teknik değerleri ve kaynakları açar.",
    fallback: "Katalog yüklendiğinde paneller bu bölümde kartlar halinde listelenir.",
  },
  {
    anchor: "filters",
    title: "Filtrele",
    body: "Seri veya model adıyla arayın; teknoloji, güç ve çift yüzlülüğe göre daraltıp sıralayın. Dar ekranda seçenekler “Filtreler” düğmesinin altındadır. Filtreler adres çubuğuna yazılır, bağlantıyı paylaşabilirsiniz.",
    fallback: "Arama ve filtreler listenin üstündedir; katalog yüklendiğinde kullanılabilir.",
  },
  {
    anchor: "compare",
    title: "Karşılaştır",
    body: "En fazla 3 paneli “Karşılaştır” kutusuyla işaretleyin, sonra alttaki “Karşılaştır” düğmesiyle yan yana görün. Tasarımda çatı yüzeyi varsa her panelin kaç modül ve kaç kWp verdiği de hesaplanır.",
    fallback: "Her panel kartında bir “Karşılaştır” kutusu vardır; işaretlenen paneller alttaki “Karşılaştır” düğmesiyle yan yana açılır.",
  },
];

const SELECT_BODY =
  "“Bu paneli seç” tasarımı seçilen panelle yeniden yerleştirir. Boyut ve güç verisi olmayan paneller seçilemez; nedeni kartta yazar.";

// The page has nothing to select into, so its last step says where selecting happens.
const STEPS: Record<PanelBrowserProps["mode"], CoachStep[]> = {
  page: [
    ...BASE_STEPS,
    {
      anchor: "select",
      title: "Seç",
      body: SELECT_BODY,
      fallback:
        "Panel seçimi tasarım ekranında yapılır: “Tasarıma dön” ile geçin, panel seçimini açın ve kartlardaki “Bu paneli seç” düğmesini kullanın. Boyut ve güç verisi olmayan paneller seçilemez.",
    },
  ],
  designer: [
    ...BASE_STEPS,
    {
      anchor: "select",
      title: "Seç",
      body: SELECT_BODY,
      fallback: "Katalog yüklendiğinde her kartta “Bu paneli seç” düğmesi görünür; seçilen panel tasarımı yeniden yerleştirir.",
    },
  ],
};

const EMPTY: ModuleRecord[] = [];

export default function PanelBrowser(props: PanelBrowserProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef} className="@container text-neutral-100">
      <header className="mb-4 grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {props.mode === "page" ? <h1 className="text-xl font-semibold tracking-tight">Paneller</h1> : <span />}
          <CoachMarks steps={STEPS[props.mode]} storageKey={TUTORIAL_STORAGE_KEY} tour="panels" scope={rootRef} />
        </div>
        <p className="text-[11px] leading-relaxed text-neutral-500">{ATTRIBUTION}</p>
      </header>
      {/* useSearchParams needs a Suspense boundary so the page shell can still be prerendered. */}
      <Suspense fallback={<LoadingState />}>
        <BrowserBody {...props} />
      </Suspense>
    </div>
  );
}

function LoadingState() {
  return (
    <div>
      <p role="status" className="text-xs text-neutral-400">
        Katalog yükleniyor…
      </p>
      <ul aria-hidden="true" className="mt-3 grid gap-3 @2xl:grid-cols-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-36 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900/60" />
        ))}
      </ul>
    </div>
  );
}

function ActiveSummary(props: { active: ActiveModule; anyUsable: boolean; status: string }) {
  const a = props.active;
  return (
    <div className="mb-4 rounded-md bg-neutral-900 px-3 py-2.5 text-xs">
      <p className="text-[11px] text-neutral-500">Tasarımda kullanılan panel</p>
      <p className="mt-0.5 font-medium text-neutral-100">{a.label}</p>
      <p className="tabular-nums text-neutral-400">
        {fmt(a.wp)} W · {fmt(a.lengthM * 1000)} × {fmt(a.widthM * 1000)} mm
      </p>
      {a.placeholder ? (
        <p className="mt-1.5 leading-relaxed text-neutral-400">
          Yer tutucu değerlerdir, gerçek bir ürün değildir.
          {props.anyUsable
            ? " Yerleşimi gerçek bir panelle hesaplamak için aşağıdan bir panel seçin."
            : " Katalogdaki kayıtlarda boyut ve güç verisi olmadığı için yerleşim şimdilik bu modülle hesaplanıyor."}
        </p>
      ) : null}
      <p aria-live="polite" className="text-amber-300">
        {props.status}
      </p>
    </div>
  );
}

function BrowserBody(props: PanelBrowserProps) {
  const designer = props.mode === "designer" ? props : null;
  const mode = props.mode;
  const query = useModules();
  const modules = query.data?.modules ?? EMPTY;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlFilters = useMemo(() => parseFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  // The URL is the source of truth; the optimistic copy shows a change at once while the
  // router catches up, instead of a checkbox that flips back for a moment.
  const [filters, setShownFilters] = useOptimistic(urlFilters);
  const [, startTransition] = useTransition();
  const latest = useRef({ filters, modules });
  useEffect(() => {
    latest.current = { filters, modules };
  });
  const trackTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(trackTimer.current), []);

  const setFilters = useCallback(
    (next: CatalogFilters) => {
      latest.current = { ...latest.current, filters: next };
      const qs = mergeFilterQuery(window.location.search, next);
      startTransition(() => {
        setShownFilters(next);
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
      window.clearTimeout(trackTimer.current);
      trackTimer.current = window.setTimeout(() => {
        track("catalog_filter_change", {
          mode,
          filters: filtersToParams(next).toString(),
          count: applyFilters(latest.current.modules, next).length,
        });
      }, 600);
    },
    [mode, pathname, router, setShownFilters],
  );
  const patchFilters = useCallback((patch: Partial<CatalogFilters>) => setFilters({ ...latest.current.filters, ...patch }), [setFilters]);
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [setFilters]);

  const shown = useMemo(() => applyFilters(modules, filters), [modules, filters]);
  const frameOptions = useMemo(() => frameColours(modules), [modules]);
  const powerBounds = useMemo(() => catalogPowerBounds(modules), [modules]);
  const byId = useMemo(() => new Map(modules.map((m) => [m.id, m])), [modules]);

  const [compareIds, setCompareIds] = useState<string[]>([]);
  // Records that vanished from a refreshed catalogue drop out of the comparison by themselves.
  const candidates = useMemo(() => compareIds.flatMap((id) => byId.get(id) ?? []), [compareIds, byId]);
  const [detail, setDetail] = useState<{ id: string; opener: HTMLElement } | null>(null);
  const [compareOpener, setCompareOpener] = useState<HTMLElement | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [status, setStatus] = useState("");
  const limitNoteId = useId();
  const locked = candidates.length >= COMPARE_LIMIT;

  const listViewTracked = useRef(false);
  useEffect(() => {
    if (!query.data || listViewTracked.current) return;
    listViewTracked.current = true;
    track("catalog_list_view", {
      mode,
      count: query.data.modules.length,
      source: query.data.source,
      catalog_version: query.data.catalog_version,
    });
  }, [query.data, mode]);

  const toggleCompare = (id: string, on: boolean) =>
    setCompareIds((ids) => {
      const live = ids.filter((x) => byId.has(x) && x !== id);
      if (!on) return live;
      return live.length >= COMPARE_LIMIT ? live : [...live, id];
    });

  const select = (m: ModuleRecord, from: "card" | "detail" | "compare") => {
    if (!designer || !isUsable(m)) return;
    designer.onSelect(m);
    track("catalog_module_selected", { id: m.id, version: m.version, from });
    setStatus(`${moduleLabel(m)} seçildi; yerleşim bu panelle yeniden hesaplanıyor.`);
  };

  const openCompare = (opener: HTMLElement) => {
    setCompareOpener(opener);
    setCompareOpen(true);
    track("catalog_compare_open", { mode, ids: candidates.map((c) => c.id), withDesign: Boolean(designer?.design?.faces.length) });
  };

  const detailModule = detail ? (byId.get(detail.id) ?? null) : null;
  const activeId = designer?.active.ref.id ?? null;
  // A refreshed catalogue can drop the records a drawer shows; close it rather than let it
  // reopen by itself if they come back.
  if (detail && !detailModule) setDetail(null);
  if (compareOpen && candidates.length === 0) setCompareOpen(false);

  const retry = (
    <button type="button" className={`${buttonSecondary} mt-2`} onClick={() => void query.refetch()} disabled={query.isFetching}>
      {query.isFetching ? "Deneniyor…" : "Tekrar dene"}
    </button>
  );
  let body: ReactNode;
  if (query.isPending) {
    body = <LoadingState />;
  } else if (!query.data) {
    body = (
      <div role="alert" className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-3 text-xs text-red-300">
        <p>{query.error?.message ?? "Katalog yüklenemedi."}</p>
        {retry}
      </div>
    );
  } else if (modules.length === 0) {
    body = <p className="text-xs text-neutral-400">Katalogda henüz panel yok.</p>;
  } else if (shown.length === 0) {
    body = (
      <div className="rounded-md border border-dashed border-neutral-800 px-3 py-6 text-center text-xs text-neutral-400">
        <p>Aramanıza veya filtrelere uyan panel bulunamadı.</p>
        <button type="button" className={`${buttonSecondary} mt-3`} onClick={resetFilters}>
          Filtreleri temizle
        </button>
      </div>
    );
  } else {
    body = (
      <ul data-tour="list" aria-label="Paneller" className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
        {shown.map((m) => (
          <PanelCard
            key={m.id}
            module={m}
            active={m.id === activeId}
            selectable={designer !== null}
            compared={compareIds.includes(m.id)}
            compareLocked={locked && !compareIds.includes(m.id)}
            limitNoteId={limitNoteId}
            onCompareChange={(on) => toggleCompare(m.id, on)}
            onOpenDetail={(opener) => setDetail({ id: m.id, opener })}
            onSelect={() => select(m, "card")}
          />
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="@3xl:grid @3xl:grid-cols-[15rem_minmax(0,1fr)] @3xl:items-start @3xl:gap-6">
        <div className="mb-4 @3xl:sticky @3xl:top-4 @3xl:mb-0">
          <PanelFilters filters={filters} onChange={patchFilters} onReset={resetFilters} frameOptions={frameOptions} powerBounds={powerBounds} />
        </div>

        <div className="min-w-0">
          {designer ? <ActiveSummary active={designer.active} anyUsable={modules.some(isUsable)} status={status} /> : null}
          <div className="mb-2 flex items-center justify-between gap-2">
            <p aria-live="polite" className="text-xs text-neutral-400">
              {query.data ? countLabel(shown.length, modules.length) : ""}
            </p>
            {query.data && !isDefaultFilters(filters) && shown.length > 0 ? (
              <button
                type="button"
                className={`text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200 ${focusRing}`}
                onClick={resetFilters}
              >
                Filtreleri temizle
              </button>
            ) : null}
          </div>
          {query.isError && query.data ? (
            <div role="alert" className="mb-3 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              <p>Katalog yenilenemedi; son yüklenen liste gösteriliyor. {query.error.message}</p>
              {retry}
            </div>
          ) : null}
          {body}

          {candidates.length > 0 ? (
            <div
              role="region"
              aria-label="Karşılaştırma"
              className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-700 bg-neutral-900/95 px-3 py-2 shadow-lg backdrop-blur"
            >
              <div className="min-w-0 text-xs">
                <p className="font-medium text-neutral-100">
                  {fmt(candidates.length)} / {COMPARE_LIMIT} panel seçildi
                </p>
                {locked ? (
                  <p id={limitNoteId} className="text-[11px] text-amber-300">
                    {COMPARE_LIMIT_TEXT}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button type="button" className={buttonSecondary} onClick={() => setCompareIds([])}>
                  Temizle
                </button>
                <button type="button" className={buttonPrimary} onClick={(e) => openCompare(e.currentTarget)}>
                  Karşılaştır
                </button>
              </div>
            </div>
          ) : null}

          {query.data ? (
            <p className="mt-4 text-[11px] text-neutral-500">
              Katalog sürümü {query.data.catalog_version} · {query.data.source === "http" ? "çevrim içi kaynak" : "yerel veri dosyası"}
            </p>
          ) : null}
        </div>
      </div>

      {detail && detailModule ? (
        <PanelDetail
          module={detailModule}
          designer={
            designer
              ? {
                  activeId: designer.active.ref.id,
                  onSelect: (m) => {
                    select(m, "detail");
                    setDetail(null);
                  },
                }
              : null
          }
          onClose={() => setDetail(null)}
          returnTo={detail.opener}
        />
      ) : null}

      {compareOpen && candidates.length > 0 ? (
        <PanelCompare
          candidates={candidates}
          design={designer?.design ?? null}
          mode={mode}
          activeId={activeId}
          onSelect={(m) => {
            select(m, "compare");
            setCompareOpen(false);
          }}
          onRemove={(id) => toggleCompare(id, false)}
          onClose={() => setCompareOpen(false)}
          returnTo={compareOpener}
        />
      ) : null}
    </>
  );
}
