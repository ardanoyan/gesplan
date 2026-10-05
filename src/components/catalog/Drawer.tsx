"use client";

/**
 * Modal side drawer for the catalogue (detail and comparison). Rendered in a portal so the
 * designer's narrow, scrolling side panel cannot clip it; full screen on phones.
 */
import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { buttonSecondary } from "./ui";
import { useModalDialog } from "./use-dialog";

export default function Drawer(props: {
  title: string;
  eyebrow?: string;
  onClose(): void;
  /** Element that gets focus back on close; defaults to whatever was focused on open. */
  returnTo: HTMLElement | null;
  size: "md" | "wide";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = useModalDialog(ref, props.onClose, props.returnTo);

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end text-neutral-100">
      {/* Clicking beside the drawer closes it; keyboards use Esc or the close button. */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/60" onClick={props.onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`relative flex h-full w-full flex-col bg-neutral-950 shadow-2xl outline-none md:border-l md:border-neutral-800 ${
          props.size === "wide" ? "md:max-w-3xl" : "md:max-w-md"
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-neutral-800 px-4 py-4">
          <div className="min-w-0">
            {props.eyebrow ? <p className="text-[11px] text-neutral-500">{props.eyebrow}</p> : null}
            <h2 id={titleId} className="wrap-anywhere text-base font-semibold">
              {props.title}
            </h2>
          </div>
          <button type="button" className={`${buttonSecondary} shrink-0`} onClick={props.onClose}>
            <span aria-hidden="true">✕ </span>Kapat
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{props.children}</div>
        {props.footer ? <footer className="border-t border-neutral-800 px-4 py-3">{props.footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
