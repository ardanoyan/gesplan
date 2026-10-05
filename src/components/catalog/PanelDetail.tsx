"use client";

import { useId } from "react";
import { useModule } from "@/lib/catalog/hooks";
import type { ModuleRecord } from "@/lib/catalog/schema";
import { moduleLabel } from "@/lib/catalog/select";
import { RecordBadges } from "./badges";
import Drawer from "./Drawer";
import { ATTRIBUTION, dimensionsLabel, efficiencyLabel, powerLabel, specGroups, unusableReason } from "./spec-rows";
import { buttonPrimary, linkText } from "./ui";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function ExternalLink(props: { href: string; children: string }) {
  return (
    <a href={props.href} target="_blank" rel="noopener noreferrer" className={linkText}>
      {props.children}
      <span className="sr-only"> (yeni sekmede açılır)</span>
    </a>
  );
}

export default function PanelDetail(props: {
  module: ModuleRecord;
  /** Designer mode only: the active module's id and the select callback. */
  designer: { activeId: string; onSelect(m: ModuleRecord): void } | null;
  onClose(): void;
  returnTo: HTMLElement | null;
}) {
  // The list already carries the full record; the single-record route only refreshes it, so a
  // slow or failing request never blanks the drawer.
  const fresh = useModule(props.module.id);
  const m = fresh.data ?? props.module;
  const removed = fresh.data === null;
  const reason = unusableReason(m);
  const reasonId = useId();
  const sourcesId = useId();
  const notesId = useId();
  const designer = props.designer;
  const active = designer?.activeId === m.id;
  const blocked = removed ? "Bu kayıt artık katalogda yok." : reason;

  return (
    <Drawer
      title={moduleLabel(m)}
      eyebrow={m.brand}
      size="md"
      onClose={props.onClose}
      returnTo={props.returnTo}
      footer={
        designer ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {blocked ? (
              <p id={reasonId} className="text-[11px] text-amber-300">
                {blocked}
              </p>
            ) : (
              <span />
            )}
            <button
              type="button"
              className={buttonPrimary}
              disabled={blocked !== null || active}
              aria-describedby={blocked ? reasonId : undefined}
              onClick={() => designer.onSelect(m)}
            >
              {active ? "Tasarımda kullanılıyor" : "Bu paneli seç"}
            </button>
          </div>
        ) : null
      }
    >
      <div className="grid gap-5 text-sm">
        {removed ? (
          <p className="rounded-md bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
            Bu kayıt artık katalogda yok; gösterilen bilgiler son yüklenen listeden.
          </p>
        ) : null}

        <div className="grid gap-2">
          <RecordBadges module={m} />
          {reason ? (
            <p className="text-xs text-amber-300">
              <span className="font-medium">Tasarımda kullanılamaz:</span> {reason}
            </p>
          ) : null}
        </div>

        <dl className="grid grid-cols-3 gap-2">
          {[
            ["Güç", powerLabel(m)],
            ["Verim", efficiencyLabel(m)],
            ["Boyut", dimensionsLabel(m)],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0 rounded-md bg-neutral-900 px-2.5 py-2">
              <dt className="text-[11px] text-neutral-500">{k}</dt>
              <dd className="text-sm font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>

        {specGroups(m).map((g) => (
          <table key={g.title} className="w-full text-xs">
            <caption className="pb-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{g.title}</caption>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.key} className="border-t border-neutral-800">
                  <th scope="row" className="py-1.5 pr-3 text-left align-top font-normal text-neutral-400">
                    {r.label}
                  </th>
                  <td className={`wrap-anywhere py-1.5 text-right tabular-nums ${r.missing ? "text-neutral-500" : "text-neutral-100"}`}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

        <section aria-labelledby={sourcesId} className="grid gap-2 text-xs">
          <h3 id={sourcesId} className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Kaynaklar
          </h3>
          <ul className="grid gap-1.5">
            <li>
              {m.datasheet_url ? (
                <>
                  <ExternalLink href={m.datasheet_url}>Veri sayfasını aç</ExternalLink>
                  <span className="ml-1.5 text-neutral-500">{hostOf(m.datasheet_url)}</span>
                </>
              ) : (
                <span className="text-neutral-500">Veri sayfası bağlantısı yok</span>
              )}
            </li>
            <li>
              <ExternalLink href={m.source_url}>Kaynak sayfayı aç</ExternalLink>
              <span className="ml-1.5 text-neutral-500">{hostOf(m.source_url)}</span>
            </li>
          </ul>
        </section>

        {m.notes.length > 0 ? (
          <section aria-labelledby={notesId} className="grid gap-2 text-xs">
            <h3 id={notesId} className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Notlar
            </h3>
            <ul className="list-disc space-y-1 pl-4 leading-relaxed text-neutral-300 wrap-anywhere">
              {m.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="text-[11px] leading-relaxed text-neutral-500">{ATTRIBUTION}</p>
      </div>
    </Drawer>
  );
}
