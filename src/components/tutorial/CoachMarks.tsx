"use client";

/**
 * A short guided tour without a library: a small popover beside each real control, found by its
 * `data-tour` attribute. It never covers the page with an overlay, so everything stays clickable;
 * only Tab is kept inside the popover while focus is there. Completion is remembered per browser.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { track } from "@/lib/analytics";
import { trapTab } from "@/components/catalog/use-dialog";
import { MARGIN, placePopover, type Placement } from "./placement";

export interface CoachStep {
  /** Value of the `data-tour` attribute of the element this step points at. */
  anchor: string;
  title: string;
  body: string;
  /** Shown instead of `body` when the anchor is not on screen; says where the action lives. */
  fallback: string;
}

// Completion lives in localStorage; reads and writes are guarded because storage can be
// missing or blocked (private windows, previews), and the tour must work without it.
const listeners = new Set<() => void>();
function readDone(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "done";
  } catch {
    return false;
  }
}
function writeDone(key: string) {
  try {
    window.localStorage.setItem(key, "done");
  } catch {
    // nothing to remember without storage; the tour stays replayable either way
  }
  for (const l of listeners) l();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function findAnchor(scope: HTMLElement | null, anchor: string): HTMLElement | null {
  const el = (scope ?? document).querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
  // display:none (a collapsed section, a hidden breakpoint) counts as absent.
  return el && el.getClientRects().length > 0 ? el : null;
}

function place(anchor: HTMLElement | null, pop: HTMLElement): Placement {
  const r = anchor?.getBoundingClientRect();
  return placePopover(
    r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null,
    { width: pop.offsetWidth, height: pop.offsetHeight },
    { width: document.documentElement.clientWidth, height: window.innerHeight },
  );
}

export default function CoachMarks(props: {
  steps: CoachStep[];
  /** localStorage key that records a finished tour. */
  storageKey: string;
  /** Analytics name of the tour. */
  tour: string;
  /** Anchors are looked up inside this element, so two tours on one page cannot collide. */
  scope: RefObject<HTMLElement | null>;
  label?: string;
}) {
  const { steps, storageKey, tour, scope } = props;
  const [state, setState] = useState<{ index: number; present: boolean } | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  // Inside a modal (the designer's panel sheet) the popover is rendered within it, so assistive
  // tech that hides everything outside an aria-modal dialog still reaches it.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const counterId = useId();
  const titleId = useId();
  const bodyId = useId();
  // The server cannot know, so it renders the finished state and the dot appears after hydration.
  const done = useSyncExternalStore(
    subscribe,
    () => readDone(storageKey),
    () => true,
  );

  const goTo = (index: number) => {
    // Hidden until the new step is measured; otherwise its text flashes at the previous anchor.
    setPlacement(null);
    setState({ index, present: findAnchor(scope.current, steps[index].anchor) !== null });
  };

  const start = () => {
    const restart = state !== null;
    setPlacement(null);
    setHost(triggerRef.current?.closest<HTMLElement>('[aria-modal="true"]') ?? document.body);
    goTo(0);
    // The page stays usable during the tour, so the button can be pressed again; that rewinds
    // the open tour rather than starting a second one.
    if (!restart) track("tutorial_start", { tour });
  };

  // A tour still open when this unmounts (the designer's panel sheet closed under it) counts as
  // dismissed, so every tutorial_start has a matching finish or dismiss.
  const openStep = useRef<number | null>(null);
  useEffect(() => {
    openStep.current = state ? state.index : null;
  });
  useEffect(
    () => () => {
      if (openStep.current !== null) track("tutorial_dismiss", { tour, step: openStep.current + 1, reason: "unmount" });
    },
    [tour],
  );

  const close = (reason: "finish" | "dismiss") => {
    if (!state) return;
    if (reason === "finish") {
      writeDone(storageKey);
      track("tutorial_finish", { tour });
    } else {
      track("tutorial_dismiss", { tour, step: state.index + 1 });
    }
    setState(null);
    setPlacement(null);
    triggerRef.current?.focus();
  };

  // Each step: bring the anchor into view, then keep the popover beside it while the page
  // scrolls (any scroll container, hence capture) or resizes, or the popover's own size changes.
  useEffect(() => {
    if (!state) return;
    const pop = popRef.current;
    if (!pop) return;
    const anchor = findAnchor(scope.current, steps[state.index].anchor);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (anchor) {
      const tall = anchor.getBoundingClientRect().height > window.innerHeight * 0.6;
      anchor.scrollIntoView({ block: tall ? "start" : "center", behavior: reduce ? "auto" : "smooth" });
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPlacement(place(anchor, pop)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(pop);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    pop.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [state, steps, scope]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close("dismiss");
      return;
    }
    if (popRef.current) trapTab(e, popRef.current);
  };

  const step = state ? steps[state.index] : null;
  const last = state !== null && state.index === steps.length - 1;
  const btn =
    "rounded-md px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={start}
        aria-expanded={state !== null}
        className={`${btn} inline-flex items-center gap-1.5 border border-neutral-700 text-neutral-200 hover:bg-neutral-800`}
      >
        {props.label ?? "Nasıl çalışır?"}
        {!done ? (
          <>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-400" />
            <span className="sr-only"> (henüz izlenmedi)</span>
          </>
        ) : null}
      </button>
      {state && step && host
        ? createPortal(
            <>
              {placement?.ring ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none fixed z-[60] rounded-lg ring-2 ring-amber-400"
                  style={{
                    top: placement.ring.top - 4,
                    left: placement.ring.left - 4,
                    width: placement.ring.width + 8,
                    height: placement.ring.height + 8,
                  }}
                />
              ) : null}
              <div
                ref={popRef}
                role="dialog"
                aria-labelledby={`${counterId} ${titleId}`}
                aria-describedby={bodyId}
                tabIndex={-1}
                onKeyDown={onKeyDown}
                className="fixed z-[61] w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-neutral-100 shadow-2xl outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-amber-400"
                // Hide instantly and only fade in: a fade-out would show the step at the fallback
                // corner for a frame. Opacity, not visibility, so the popover can keep focus.
                style={{
                  top: placement?.top ?? MARGIN,
                  left: placement?.left ?? MARGIN,
                  opacity: placement ? 1 : 0,
                  transition: placement ? undefined : "none",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <p id={counterId} className="text-[11px] text-neutral-400">
                    Adım {state.index + 1} / {steps.length}
                  </p>
                  <button
                    type="button"
                    aria-label="Turu kapat"
                    onClick={() => close("dismiss")}
                    className={`${btn} -mr-1.5 -mt-1.5 px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100`}
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
                <h2 id={titleId} className="mt-1 text-sm font-semibold">
                  {step.title}
                </h2>
                <p id={bodyId} className="mt-1.5 text-xs leading-relaxed text-neutral-300">
                  {state.present ? step.body : step.fallback}
                </p>
                <div className="mt-4 flex items-center justify-between gap-2">
                  {state.index > 0 ? (
                    <button
                      type="button"
                      onClick={() => goTo(state.index - 1)}
                      className={`${btn} border border-neutral-700 text-neutral-200 hover:bg-neutral-800`}
                    >
                      Geri
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={() => (last ? close("finish") : goTo(state.index + 1))}
                    className={`${btn} bg-amber-400 font-medium text-neutral-950 hover:bg-amber-300`}
                  >
                    {last ? "Bitir" : "İleri"}
                  </button>
                </div>
              </div>
            </>,
            host,
          )
        : null}
    </>
  );
}
