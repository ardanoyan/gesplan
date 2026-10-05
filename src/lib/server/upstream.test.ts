import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedCache } from "./upstream";

afterEach(() => vi.useRealTimers());

describe("boundedCache", () => {
  it("evicts the least recently used entry beyond its cap", () => {
    const c = boundedCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1); // "a" is now the most recent
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });

  it("drops entries older than the TTL", () => {
    vi.useFakeTimers();
    const c = boundedCache<number>(10, 1000);
    c.set("a", 1);
    vi.advanceTimersByTime(999);
    expect(c.get("a")).toBe(1);
    vi.advanceTimersByTime(1);
    expect(c.get("a")).toBeUndefined();
  });
});
