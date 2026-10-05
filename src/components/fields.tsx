"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { fmt, parseNumber } from "@/lib/format";

function inputText(value: number, digits: number): string {
  return value.toLocaleString("tr-TR", { maximumFractionDigits: digits, useGrouping: false });
}

// Installers often type the unit too ("1,5 m", "12°", "590 Wp", "%14"); drop it before parsing.
function stripUnit(text: string): string {
  return text.trim().replace(/^%\s*/, "").replace(/(\d)\s*[^\d\s.,+-][^\d]*$/, "$1");
}

// A bound without trailing zeros: 60 rather than 60,0 in a one-decimal field.
function fmtBound(v: number, digits: number): string {
  let d = 0;
  while (d < digits && Number(v.toFixed(d)) !== v) d++;
  return fmt(v, d);
}

function rangeText(min: number, max: number, digits: number): string {
  if (Number.isFinite(min) && Number.isFinite(max)) return `${fmtBound(min, digits)} ile ${fmtBound(max, digits)} arasında bir değer girin.`;
  return Number.isFinite(min) ? `En az ${fmtBound(min, digits)} olmalı.` : `En fazla ${fmtBound(max, digits)} olmalı.`;
}

/** Number input that accepts Turkish comma decimals and commits on blur or Enter. */
export function NumberField(props: {
  label: string;
  value: number;
  onChange(value: number): void;
  unit?: string;
  min?: number;
  max?: number;
  digits?: number;
  hint?: string;
  /** "clamp" (default) pulls out-of-range input to min/max; "reject" keeps the old value. Both tell the user. */
  outOfRange?: "clamp" | "reject";
}) {
  const { label, value, onChange, unit, min = -Infinity, max = Infinity, digits = 2, hint, outOfRange = "clamp" } = props;
  // `draft` holds the raw text only while the field is being edited; otherwise the prop is shown.
  const [draft, setDraft] = useState<string | null>(null);
  // Tells the user what happened to rejected or clamped input. It belongs to the value it was written
  // for, so it disappears if the field is reused for another shape with a different value.
  const [note, setNote] = useState<{ text: string; tone: "warn" | "error"; value: number } | null>(null);
  const hintId = useId();
  const noteId = useId();
  const shown = draft ?? inputText(value, digits);
  const shownNote = note && note.value === value ? note : null;

  const commit = () => {
    if (draft === null) return;
    const parsed = parseNumber(stripUnit(draft));
    setDraft(null);
    if (parsed === null) {
      setNote({ text: "Geçerli bir sayı girin (ör. 1,5).", tone: "error", value });
      return;
    }
    // Round to the precision the field shows, so the value on screen is the value used (and -0 becomes 0).
    const n = Number(parsed.toFixed(digits)) || 0;
    if (n >= min && n <= max) {
      onChange(n);
      return;
    }
    if (outOfRange === "reject") {
      setNote({ text: rangeText(min, max, digits), tone: "error", value });
      return;
    }
    const clamped = n < min ? min : max;
    const b = fmtBound(clamped, digits);
    setNote({ text: n < min ? `En az ${b} olabilir; ${b} kullanıldı.` : `En fazla ${b} olabilir; ${b} kullanıldı.`, tone: "warn", value: clamped });
    onChange(clamped);
  };

  return (
    <div>
      <label className="block">
        <span className="text-xs text-neutral-400">{label}</span>
        <div className="mt-1 flex items-center rounded-md border border-neutral-700 bg-neutral-900 focus-within:border-amber-400">
          <input
            className="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none"
            inputMode="decimal"
            value={shown}
            aria-describedby={hint ? `${hintId} ${noteId}` : noteId}
            onChange={(e) => {
              setDraft(e.target.value);
              setNote(null);
            }}
            onFocus={() => {
              setDraft(inputText(value, digits));
              setNote(null);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          {unit ? <span className="pr-2 text-xs text-neutral-500">{unit}</span> : null}
        </div>
      </label>
      {/* Hint and note sit outside the label so they describe the input instead of joining its name. */}
      {hint ? (
        <span id={hintId} className="mt-0.5 block text-[11px] text-neutral-500">
          {hint}
        </span>
      ) : null}
      <span
        id={noteId}
        aria-live="polite"
        className={`block text-[11px] ${shownNote ? "mt-0.5" : ""} ${shownNote?.tone === "error" ? "text-red-400" : "text-amber-300"}`}
      >
        {shownNote?.text}
      </span>
    </div>
  );
}

export function TextField(props: { label: string; value: string; onChange(value: string): void }) {
  return (
    <label className="block">
      <span className="text-xs text-neutral-400">{props.label}</span>
      <input
        className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-amber-400"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

/** Single choice as a WAI-ARIA radio group: Tab reaches the checked option, arrow keys move and select. */
export function Segmented<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
}) {
  const labelId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = props.options.findIndex((o) => o.value === props.value);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (index + step + props.options.length) % props.options.length;
    props.onChange(props.options[next].value);
    buttons.current[next]?.focus();
  };

  return (
    <div>
      <span id={labelId} className="text-xs text-neutral-400">
        {props.label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="mt-1 grid rounded-md border border-neutral-700 p-0.5"
        style={{ gridTemplateColumns: `repeat(${props.options.length}, 1fr)` }}
      >
        {props.options.map((o, i) => {
          const checked = i === checkedIndex;
          return (
            <button
              key={String(o.value)}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              // Roving tabindex; if nothing matches the value, the first option stays reachable.
              tabIndex={checked || (checkedIndex === -1 && i === 0) ? 0 : -1}
              onClick={() => props.onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`rounded px-2 py-1 text-sm transition-colors ${
                checked ? "bg-amber-400 font-medium text-neutral-950" : "text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Section(props: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-neutral-800 px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{props.title}</h2>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

export function Stat(props: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-md bg-neutral-900 px-3 py-2">
      <div className="text-[11px] text-neutral-500">{props.label}</div>
      <div className="text-lg font-semibold tabular-nums">
        {props.value}
        {props.unit ? <span className="ml-1 text-xs font-normal text-neutral-400">{props.unit}</span> : null}
      </div>
    </div>
  );
}
