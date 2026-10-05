import { describe, expect, it } from "vitest";
import { GAP, MARGIN, placePopover } from "./placement";

const viewport = { width: 375, height: 800 };
const pop = { width: 320, height: 180 };

describe("placePopover", () => {
  it("centres the popover when the step has no anchor", () => {
    expect(placePopover(null, pop, viewport)).toEqual({ top: 310, left: 27.5, ring: null });
  });

  it("goes below the anchor when there is room", () => {
    const anchor = { top: 100, left: 20, width: 200, height: 40 };
    const p = placePopover(anchor, pop, viewport);
    expect(p.top).toBe(140 + GAP);
    expect(p.ring).toEqual(anchor);
  });

  it("goes above the anchor when there is no room below", () => {
    const anchor = { top: 600, left: 20, width: 200, height: 40 };
    expect(placePopover(anchor, pop, viewport).top).toBe(600 - GAP - pop.height);
  });

  it("sits just inside the top edge of an anchor taller than the free space", () => {
    const anchor = { top: 120, left: 0, width: 375, height: 1500 };
    expect(placePopover(anchor, pop, viewport).top).toBe(120 + GAP);
  });

  it("stays on screen when the anchor has scrolled out of view", () => {
    const above = placePopover({ top: -400, left: 20, width: 200, height: 40 }, pop, viewport);
    expect(above.top).toBe(MARGIN);
    const below = placePopover({ top: 2000, left: 20, width: 200, height: 40 }, pop, viewport);
    expect(below.top).toBe(viewport.height - pop.height - MARGIN);
  });

  it("keeps the margin at both side edges", () => {
    expect(placePopover({ top: 100, left: 0, width: 20, height: 20 }, pop, viewport).left).toBe(MARGIN);
    expect(placePopover({ top: 100, left: 360, width: 20, height: 20 }, pop, viewport).left).toBe(viewport.width - pop.width - MARGIN);
  });

  it("pins a popover larger than the viewport to the top-left margin", () => {
    const p = placePopover(null, { width: 500, height: 900 }, viewport);
    expect(p).toMatchObject({ top: MARGIN, left: MARGIN });
  });
});
