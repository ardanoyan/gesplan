"use client";

import { useId } from "react";
import type { ModuleRecord } from "@/lib/catalog/schema";
import { moduleLabel } from "@/lib/catalog/select";
import { RecordBadges } from "./badges";
import { dimensionsLabel, efficiencyLabel, powerLabel, unusableReason } from "./spec-rows";
import { buttonPrimary, buttonSecondary, focusRing } from "./ui";

export interface PanelCardProps {
  module: ModuleRecord;
  /** Designer mode: this record is the module the design packs with. */
  active: boolean;
  /** Designer mode shows "Bu paneli seç"; page mode has nothing to select into. */
  selectable: boolean;
  compared: boolean;
  /** True when the compare limit is reached and this record is not one of the compared ones. */
  compareLocked: boolean;
  /** Id of the visible "En fazla 3 panel..." note, read out by a locked checkbox. */
  limitNoteId: string;
  onCompareChange(checked: boolean): void;
  onOpenDetail(opener: HTMLElement): void;
  onSelect(): void;
}

export default function PanelCard(props: PanelCardProps) {
  const { module: m, active } = props;
  const titleId = useId();
  const reasonId = useId();
  const label = moduleLabel(m);
  const reason = unusableReason(m);

  // Control names that repeat the panel label go in aria-label: a visually hidden span is
  // absolutely positioned, and Chrome pads it with spaces, giving "Karşılaştır : <panel>".
  return (
    <li
      aria-current={active ? "true" : undefined}
      className={`rounded-lg border p-3 ${active ? "border-amber-400 bg-amber-400/5" : "border-neutral-800 bg-neutral-900/60"}`}
    >
      <article aria-labelledby={titleId} className="flex h-full flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-neutral-500">{m.brand}</p>
            <h3 id={titleId} className="wrap-anywhere text-sm font-semibold text-neutral-100">
              {label}
            </h3>
          </div>
          {active ? (
            <span className="shrink-0 rounded-full border border-amber-400/60 px-2 py-0.5 text-[11px] font-medium text-amber-300">
              <span aria-hidden="true">✓ </span>Seçili
            </span>
          ) : null}
        </div>

        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div className="min-w-0">
            <dt className="text-[11px] text-neutral-500">Güç</dt>
            <dd className="tabular-nums text-neutral-100">{powerLabel(m)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-neutral-500">Verim</dt>
            <dd className="tabular-nums text-neutral-100">{efficiencyLabel(m)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-neutral-500">Boyut</dt>
            <dd className={`tabular-nums ${m.length_mm === null || m.width_mm === null ? "text-neutral-500" : "text-neutral-100"}`}>
              {dimensionsLabel(m)}
            </dd>
          </div>
        </dl>

        <RecordBadges module={m} />

        {reason ? (
          <p id={reasonId} className="text-[11px] leading-relaxed text-amber-300">
            <span className="font-medium">Tasarımda kullanılamaz:</span> {reason}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <button type="button" className={buttonSecondary} aria-label={`Ayrıntılar: ${label}`} onClick={(e) => props.onOpenDetail(e.currentTarget)}>
            Ayrıntılar
          </button>
          <label data-tour="compare" className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-neutral-300 has-[:disabled]:cursor-not-allowed has-[:disabled]:text-neutral-500">
            <input
              type="checkbox"
              className={`size-4 accent-amber-400 ${focusRing}`}
              checked={props.compared}
              disabled={props.compareLocked}
              aria-label={`Karşılaştır: ${label}`}
              aria-describedby={props.compareLocked ? props.limitNoteId : undefined}
              onChange={(e) => props.onCompareChange(e.target.checked)}
            />
            Karşılaştır
          </label>
          {props.selectable ? (
            <button
              type="button"
              data-tour="select"
              className={`${buttonPrimary} ml-auto`}
              disabled={reason !== null || active}
              aria-label={active ? undefined : `Bu paneli seç: ${label}`}
              aria-describedby={reason ? reasonId : undefined}
              onClick={props.onSelect}
            >
              {active ? "Tasarımda kullanılıyor" : "Bu paneli seç"}
            </button>
          ) : null}
        </div>
      </article>
    </li>
  );
}
