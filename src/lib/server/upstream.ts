/**
 * Small in-process guards for the proxy routes: a bounded cache and upstream throttles.
 * Enough for a local prototype; several server instances would each keep their own state,
 * so a deployment needs a shared cache and limiter instead.
 */

export interface BoundedCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
}

/** Cache with a size cap and TTL; Map insertion order doubles as the LRU order. */
export function boundedCache<V>(maxEntries = 500, ttlMs = 24 * 60 * 60 * 1000): BoundedCache<V> {
  const map = new Map<string, { value: V; expires: number }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      map.delete(key);
      if (hit.expires <= Date.now()) return undefined;
      map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, expires: Date.now() + ttlMs });
      while (map.size > maxEntries) map.delete(map.keys().next().value as string);
    },
  };
}

/**
 * Returns a function whose promise resolves when the caller may start its request, with
 * turns handed out in call order at least `gapMs` apart (a module-level promise chain).
 */
export function spacedTurns(gapMs: number): () => Promise<void> {
  let last: Promise<void> = Promise.resolve();
  return () => {
    const turn = last;
    last = turn.then(() => new Promise((resolve) => setTimeout(resolve, gapMs)));
    return turn;
  };
}

/** Runs tasks with at most `max` in flight; the rest wait in call order. */
export function concurrencyLimit(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active < max) active += 1;
    // a finishing task hands its slot straight to the next waiter, so `active` never overshoots
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
