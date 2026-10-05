"use client";

import { useEffect, useId, useRef, useState } from "react";
import { NumberField, Segmented } from "@/components/fields";
import type { CatalogFilters, SortKey } from "@/lib/catalog/filters";
import type { Technology } from "@/lib/catalog/schema";
import { activeFilterCount, isDefaultFilters } from "./filter-state";
import { frameColourLabel, technologyLabel } from "./spec-rows";
import { buttonSecondary, focusRing } from "./ui";

const TECHNOLOGIES: Technology[] = ["topcon", "perc", "unknown"];
const SORTS: { value: SortKey; label: string }[] = [
  { value: "power", label: "Güç" },
  { value: "efficiency", label: "Verim" },
  { value: "size", label: "Boyut" },
];

const toggle = <T,>(list: T[], value: T, on: boolean): T[] => (on ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value));

function CheckboxGroup<T extends string>(props: {
  legend: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange(next: T[]): void;
}) {
  return (
    <fieldset>
      <legend className="text-xs text-neutral-400">{props.legend}</legend>
      <div className="mt-1.5 grid gap-1.5">
        {props.options.map((o) => (
          <label key={o.value} className="inline-flex cursor-pointer items-center gap-2 text-sm text-neutral-200">
            <input
              type="checkbox"
              className={`size-4 accent-amber-400 ${focusRing}`}
              checked={props.selected.includes(o.value)}
              onChange={(e) => props.onChange(toggle(props.selected, o.value, e.target.checked))}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function PanelFilters(props: {
  filters: CatalogFilters;
  onChange(patch: Partial<CatalogFilters>): void;
  onReset(): void;
  frameOptions: string[];
  /** Lowest and highest published power in the catalogue; null when no record gives any. */
  powerBounds: { min: number; max: number } | null;
}) {
  const { filters, onChange, powerBounds } = props;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const searchId = useId();

  // The search box is typed into freely and written to the URL after a short pause. A change
  // that arrives from outside (reset, back button) replaces the draft; our own commit does not,
  // so a keystroke made while the URL catches up is never lost.
  const [draft, setDraft] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  const [ownQ, setOwnQ] = useState<string | null>(null);
  if (filters.q !== seenQ) {
    setSeenQ(filters.q);
    if (filters.q !== ownQ) setDraft(filters.q);
  }
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onSearch = (value: string) => {
    setDraft(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setOwnQ(value);
      onChange({ q: value });
    }, 250);
  };

  const count = activeFilterCount(filters);
  const lo = filters.minW ?? powerBounds?.min ?? 0;
  const hi = filters.maxW ?? powerBounds?.max ?? 0;

  return (
    <div data-tour="filters" className="grid gap-3">
      <div>
        <label htmlFor={searchId} className="text-xs text-neutral-400">
          Panel ara
        </label>
        <input
          id={searchId}
          type="search"
          value={draft}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Seri veya model adı"
          autoComplete="off"
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none placeholder:text-neutral-500 focus:border-amber-400"
        />
      </div>

      {/* Collapsed behind a disclosure when the browser is narrow (phone, designer side panel). */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`${buttonSecondary} flex items-center justify-between @3xl:hidden`}
      >
        <span>
          Filtreler
          {count > 0 ? <span className="ml-1.5 text-amber-300">({count})</span> : null}
        </span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>

      <div id={panelId} className={`${open ? "grid" : "hidden"} gap-4 @3xl:grid`}>
        <CheckboxGroup
          legend="Teknoloji"
          options={TECHNOLOGIES.map((t) => ({ value: t, label: t === "unknown" ? "Belirtilmemiş" : technologyLabel(t) }))}
          selected={filters.technology}
          onChange={(technology) => onChange({ technology })}
        />

        {powerBounds ? (
          <fieldset>
            <legend className="text-xs text-neutral-400">Güç</legend>
            <div className="mt-1 grid grid-cols-2 gap-3">
              {/* A field at the catalogue's own bound means "no limit", so it is stored as null. */}
              <NumberField
                label="En az"
                unit="W"
                digits={0}
                min={powerBounds.min}
                max={hi}
                value={lo}
                onChange={(v) => onChange({ minW: v <= powerBounds.min ? null : v })}
              />
              <NumberField
                label="En çok"
                unit="W"
                digits={0}
                min={lo}
                max={powerBounds.max}
                value={hi}
                onChange={(v) => onChange({ maxW: v >= powerBounds.max ? null : v })}
              />
            </div>
            <p className="mt-1 text-[11px] text-neutral-500">Seri kayıtlarında yayımlanan güç aralığı dikkate alınır.</p>
          </fieldset>
        ) : null}

        <Segmented
          label="Çift yüzlülük"
          value={filters.bifacial}
          options={[
            { value: "any", label: "Tümü" },
            { value: "yes", label: "Çift yüzlü" },
            { value: "no", label: "Tek yüzlü" },
          ]}
          onChange={(bifacial) => onChange({ bifacial })}
        />

        {props.frameOptions.length > 0 ? (
          <CheckboxGroup
            legend="Çerçeve rengi"
            options={props.frameOptions.map((c) => ({ value: c, label: frameColourLabel(c) }))}
            selected={filters.frame}
            onChange={(frame) => onChange({ frame })}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-neutral-400">Sırala</span>
            <select
              value={filters.sort}
              onChange={(e) => onChange({ sort: SORTS.find((s) => s.value === e.target.value)?.value ?? filters.sort })}
              className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-amber-400"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <Segmented
            label="Yön"
            value={filters.dir}
            options={[
              { value: "desc", label: "Azalan" },
              { value: "asc", label: "Artan" },
            ]}
            onChange={(dir) => onChange({ dir })}
          />
        </div>

        {!isDefaultFilters(filters) ? (
          <button
            type="button"
            className={`${buttonSecondary} justify-self-start`}
            onClick={() => {
              window.clearTimeout(timer.current);
              props.onReset();
            }}
          >
            Filtreleri temizle
          </button>
        ) : null}
      </div>
    </div>
  );
}
