"use client";

/**
 * "Panel seçimi" inside the designer: the catalogue browser plus compare-on-this-roof.
 * The designer renders it as its side panel content and owns opening and closing it; its
 * dialog is labelled by this heading's id, PANEL_SELECTION_TITLE_ID.
 */
import type { KeyboardEvent } from "react";
import type { DesignSnapshot } from "@/lib/catalog/compare";
import type { ModuleRecord } from "@/lib/catalog/schema";
import type { ActiveModule } from "@/lib/catalog/select";
import PanelBrowser from "./PanelBrowser";
import { buttonSecondary } from "./ui";

export interface PanelSelectionProps {
  /** Null when the design has no roof faces yet; compare then shows specs only. */
  design: DesignSnapshot | null;
  active: ActiveModule;
  onSelect(module: ModuleRecord): void;
  onClose(): void;
}

// The designer listens on window for R, E, V, Delete and Backspace, and turns that off while its
// sheet is open. Stopping the keys here too keeps them inside the panel however it is shown:
// Backspace on a button here must never delete the selected roof, and R must not switch the map
// to drawing. Esc and arrows pass through untouched.
function keepShortcutsInside(e: KeyboardEvent<HTMLElement>) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Delete" || e.key === "Backspace" || e.key.length === 1) e.stopPropagation();
}

export const PANEL_SELECTION_TITLE_ID = "panel-selection-title";

export default function PanelSelection(props: PanelSelectionProps) {
  // A plain wrapper: the designer's dialog already carries the name, so a labelled region here
  // would only be announced twice.
  return (
    <div className="px-4 pb-6 pt-5" onKeyDown={keepShortcutsInside}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={PANEL_SELECTION_TITLE_ID} className="text-lg font-semibold tracking-tight">
          Panel seçimi
        </h2>
        <button type="button" className={buttonSecondary} onClick={props.onClose}>
          <span aria-hidden="true">✕ </span>Kapat
        </button>
      </div>
      <PanelBrowser mode="designer" design={props.design} active={props.active} onSelect={props.onSelect} />
    </div>
  );
}
