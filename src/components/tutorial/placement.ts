/**
 * Where the tour popover sits, as pure arithmetic on rectangles so it can be tested without a
 * browser. All values are viewport pixels (getBoundingClientRect, position: fixed).
 */
export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  /** Highlight around the anchor; null when the step has no anchor on screen. */
  ring: Rect | null;
}

/** Distance kept from the viewport edges. */
export const MARGIN = 8;
/** Distance between the anchor and the popover. */
export const GAP = 12;

function clamp(v: number, lo: number, hi: number): number {
  // A popover larger than the viewport pins to the top-left margin instead of going negative.
  return Math.max(lo, Math.min(v, Math.max(lo, hi)));
}

/**
 * Below the anchor when it fits, else above it, else just inside the top edge of a tall anchor
 * (the whole list leaves no room on either side). Without an anchor the popover is centred.
 * The result is always kept inside the viewport, so an anchor scrolled out of view never takes
 * the popover (and the focus inside it) off screen.
 */
export function placePopover(anchor: Rect | null, pop: Size, viewport: Size): Placement {
  const maxTop = viewport.height - pop.height - MARGIN;
  const maxLeft = viewport.width - pop.width - MARGIN;
  if (!anchor) {
    return {
      top: clamp((viewport.height - pop.height) / 2, MARGIN, maxTop),
      left: clamp((viewport.width - pop.width) / 2, MARGIN, maxLeft),
      ring: null,
    };
  }
  const bottom = anchor.top + anchor.height;
  let top: number;
  if (bottom + GAP + pop.height <= viewport.height - MARGIN) top = bottom + GAP;
  else if (anchor.top - GAP - pop.height >= MARGIN) top = anchor.top - GAP - pop.height;
  else top = anchor.top + GAP;
  return {
    top: clamp(top, MARGIN, maxTop),
    left: clamp(anchor.left + anchor.width / 2 - pop.width / 2, MARGIN, maxLeft),
    ring: { ...anchor },
  };
}
