/**
 * Analytics stub: logs in development, does nothing elsewhere. Swap the body for a real client
 * later; call sites stay the same.
 */
export type AnalyticsEvent =
  | "catalog_list_view"
  | "catalog_filter_change"
  | "catalog_compare_open"
  | "catalog_module_selected"
  | "tutorial_start"
  | "tutorial_finish"
  | "tutorial_dismiss";

export function track(event: AnalyticsEvent | (string & {}), props?: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[analytics]", event, props ?? {});
}
