/** Small text badges for catalogue records. Each carries its meaning in words, never colour alone. */
import type { ModuleRecord } from "@/lib/catalog/schema";
import { bifacialLabel, technologyLabel } from "./spec-rows";

const base = "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-4";

export function Badge(props: { children: string; tone?: "neutral" | "warn" | "muted" }) {
  const tone =
    props.tone === "warn"
      ? "bg-amber-400/10 text-amber-300"
      : props.tone === "muted"
        ? "border border-neutral-700 text-neutral-400"
        : "bg-neutral-800 text-neutral-200";
  return <span className={`${base} ${tone}`}>{props.children}</span>;
}

/** Technology, bifaciality and verification status, in that order. */
export function RecordBadges(props: { module: ModuleRecord }) {
  const m = props.module;
  const bifacial = bifacialLabel(m.bifacial);
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Özellikler">
      <li>
        <Badge tone={m.technology === "unknown" ? "muted" : "neutral"}>{technologyLabel(m.technology)}</Badge>
      </li>
      {bifacial ? (
        <li>
          <Badge>{bifacial}</Badge>
        </li>
      ) : null}
      {m.record_level === "series" ? (
        <li>
          <Badge tone="muted">Seri kaydı</Badge>
        </li>
      ) : null}
      {!m.verified ? (
        <li>
          <Badge tone="warn">veri doğrulanmadı</Badge>
        </li>
      ) : null}
    </ul>
  );
}
