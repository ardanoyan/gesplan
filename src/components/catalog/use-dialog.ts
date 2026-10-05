"use client";

/**
 * Focus handling shared by the catalogue drawers and the tutorial popover: Tab stays inside,
 * Esc closes, and focus goes back to whatever opened the dialog.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

/** Keeps Tab and Shift+Tab cycling inside `root`; the root itself counts as the start. */
export function trapTab(e: KeyboardEvent<HTMLElement>, root: HTMLElement): void {
  if (e.key !== "Tab") return;
  const items = focusables(root);
  if (items.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Modal dialog rendered in a portal: focuses the dialog on mount, makes the rest of the page
 * inert and unscrollable while open, and returns focus to `returnTo` (or the element focused
 * before opening) on unmount. Returns the dialog's keydown handler.
 */
export function useModalDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  returnTo: HTMLElement | null = null,
): (e: KeyboardEvent<HTMLElement>) => void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    // Everything outside the portal becomes inert, so neither a screen reader's virtual cursor
    // nor a stray click can reach the page behind the drawer.
    let top: HTMLElement = dialog;
    while (top.parentElement && top.parentElement !== document.body) top = top.parentElement;
    const madeInert: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === top || el.hasAttribute("inert") || el.tagName === "SCRIPT") continue;
      el.setAttribute("inert", "");
      madeInert.push(el);
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.focus();
    return () => {
      for (const el of madeInert) el.removeAttribute("inert");
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [ref, returnTo]);

  return useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Escape") {
        // Stops here so the designer's own Esc handling (cancel drawing) does not also fire.
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (ref.current) trapTab(e, ref.current);
    },
    [ref],
  );
}
