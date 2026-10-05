"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { compareOnDesign, type CandidateResult, type DesignSnapshot } from "@/lib/catalog/compare";
import type { ModuleRecord } from "@/lib/catalog/schema";
import { moduleLabel } from "@/lib/catalog/select";
import { fmt } from "@/lib/format";
import Drawer from "./Drawer";
import { ATTRIBUTION, NO_DATA, NO_DESIGN_TEXT, compareRows, unusableReason } from "./spec-rows";
import { buttonPrimary, buttonSecondary, focusRing, linkText } from "./ui";

/**
 * The design as of its last quiet moment: a dragged vertex re-renders the designer many times a
 * second, and each comparison packs every face once per candidate, so it waits ~250 ms. Keyed by
 * content, so a snapshot rebuilt with the same values does not repack.
 */
function useSettledDesign(design: DesignSnapshot | null, delayMs = 250) {
  const key = useMemo(() => (design ? JSON.stringify(design) : ""), [design]);
  const [settled, setSettled] = useState({ key, design });
  useEffect(() => {
    if (key === settled.key) return;
    const t = window.setTimeout(() => setSettled({ key, design }), delayMs);
    return () => window.clearTimeout(t);
  }, [key, design, settled.key, delayMs]);
  return { design: settled.design, pending: key !== settled.key };
}

/**
 * The candidate list, kept as the same array while the ids and record versions stay the same,
 * so a refetched catalogue that rebuilds the records does not repack every face.
 */
function useCandidatesByVersion(candidates: ModuleRecord[]): ModuleRecord[] {
  const key = candidates.map((c) => `${c.id}@${c.version}`).join("|");
  const [kept, setKept] = useState({ key, candidates });
  if (kept.key !== key) setKept({ key, candidates });
  return kept.key === key ? kept.candidates : candidates;
}

export default function PanelCompare(props: {
  candidates: ModuleRecord[];
  /** Page mode has no design at all; designer mode passes null until a roof face exists. */
  design: DesignSnapshot | null;
  mode: "page" | "designer";
  activeId: string | null;
  onSelect(m: ModuleRecord): void;
  onRemove(id: string): void;
  onClose(): void;
  returnTo: HTMLElement | null;
}) {
  const candidates = useCandidatesByVersion(props.candidates);
  const captionId = useId();
  const designHeadingId = useId();
  const rows = useMemo(() => compareRows(candidates), [candidates]);
  const { design, pending } = useSettledDesign(props.design);
  const hasFaces = design !== null && design.faces.length > 0;
  // Repacks only when a candidate id or record version, or the settled design, changes.
  const results = useMemo<CandidateResult[] | null>(
    () => (design && design.faces.length > 0 ? compareOnDesign(candidates, design) : null),
    [candidates, design],
  );

  return (
    <Drawer title="Panel karşılaştırması" size="wide" onClose={props.onClose} returnTo={props.returnTo}>
      <div className="grid gap-6 text-sm">
        {candidates.length > 1 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Karşılaştırılan paneller">
            {candidates.map((c) => (
              <li key={c.id}>
                <button type="button" className={buttonSecondary} onClick={() => props.onRemove(c.id)}>
                  {moduleLabel(c)} <span aria-hidden="true">✕</span>
                  <span className="sr-only"> karşılaştırmadan çıkar</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Scrolls sideways on its own on narrow screens, so the page never does. */}
        <div role="region" aria-labelledby={captionId} tabIndex={0} className={`overflow-x-auto rounded-md border border-neutral-800 ${focusRing}`}>
          <table className="w-full text-xs" style={{ minWidth: `${9 + candidates.length * 10}rem` }}>
            <caption id={captionId} className="px-3 pb-1 pt-3 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Teknik değerler
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 bg-neutral-950 px-3 py-2 text-left font-normal text-neutral-500">
                  Özellik
                </th>
                {candidates.map((c) => (
                  <th key={c.id} scope="col" className="px-3 py-2 text-left font-semibold text-neutral-100">
                    {moduleLabel(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-neutral-800">
                  <th scope="row" className="sticky left-0 bg-neutral-950 px-3 py-1.5 text-left align-top font-normal text-neutral-400">
                    {r.label}
                  </th>
                  {r.values.map((v, i) => (
                    <td key={candidates[i].id} className={`px-3 py-1.5 align-top tabular-nums ${v === NO_DATA ? "text-neutral-500" : "text-neutral-100"}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section aria-labelledby={designHeadingId} className="grid gap-3">
          <h3 id={designHeadingId} className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Bu tasarımda
          </h3>
          {!hasFaces ? (
            props.mode === "designer" ? (
              <p className="text-xs text-neutral-400">{NO_DESIGN_TEXT}</p>
            ) : (
              <p className="text-xs leading-relaxed text-neutral-400">
                Çatınıza kaç panel sığacağını görmek için karşılaştırmayı tasarım ekranındaki panel seçiminden açın.{" "}
                <Link href="/" className={linkText}>
                  Tasarıma dön
                </Link>
              </p>
            )
          ) : (
            <>
              <ul className={`grid gap-3 ${candidates.length > 1 ? "md:grid-cols-3" : ""} ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
                {candidates.map((c) => (
                  <CandidateBlock
                    key={c.id}
                    module={c}
                    result={results?.find((r) => r.id === c.id) ?? null}
                    mode={props.mode}
                    active={props.activeId === c.id}
                    onSelect={() => props.onSelect(c)}
                  />
                ))}
              </ul>
              <p className="text-[11px] leading-relaxed text-neutral-500">
                Aynı çatı yüzeyleri, kenar boşlukları ve engellerle hesaplanır; adaylar arasında yalnızca panel ölçüsü ve gücü değişir.
              </p>
            </>
          )}
        </section>

        <p className="text-[11px] leading-relaxed text-neutral-500">{ATTRIBUTION}</p>
      </div>
    </Drawer>
  );
}

function CandidateBlock(props: {
  module: ModuleRecord;
  result: CandidateResult | null;
  mode: "page" | "designer";
  active: boolean;
  onSelect(): void;
}) {
  const { module: m, result } = props;
  const headingId = useId();
  const reasonId = useId();
  const reason = unusableReason(m);
  return (
    <li className={`flex flex-col gap-2 rounded-md border p-3 ${props.active ? "border-amber-400" : "border-neutral-800"}`}>
      <h4 id={headingId} className="wrap-anywhere text-xs font-semibold text-neutral-100">
        {moduleLabel(m)}
        {props.active ? <span className="ml-1.5 font-normal text-amber-300">(seçili)</span> : null}
      </h4>
      {result?.usable ? (
        <>
          <p className="text-base font-semibold tabular-nums">
            {fmt(result.count)} modül · {fmt(result.kwp, 1)} kWp
          </p>
          <table className="w-full text-[11px]" aria-labelledby={headingId}>
            <thead className="text-neutral-500">
              <tr>
                <th scope="col" className="py-1 text-left font-normal">
                  Yüzey
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Modül
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  kWp
                </th>
              </tr>
            </thead>
            <tbody>
              {result.perFace.map((f) => (
                <tr key={f.id} className="border-t border-neutral-800">
                  <th scope="row" className="wrap-anywhere py-1 text-left font-normal text-neutral-300">
                    {f.name}
                  </th>
                  <td className="py-1 text-right tabular-nums">{fmt(f.count)}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(f.kwp, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p id={reasonId} className="text-xs text-amber-300">
          {reason ?? "Yerleşim hesaplanamadı."}
        </p>
      )}
      {props.mode === "designer" ? (
        <button
          type="button"
          className={`${buttonPrimary} mt-auto`}
          disabled={reason !== null || props.active}
          aria-label={props.active ? undefined : `Bu paneli seç: ${moduleLabel(m)}`}
          aria-describedby={reason ? reasonId : undefined}
          onClick={props.onSelect}
        >
          {props.active ? "Tasarımda kullanılıyor" : "Bu paneli seç"}
        </button>
      ) : null}
    </li>
  );
}
