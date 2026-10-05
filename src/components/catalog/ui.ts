/** Shared class strings for the catalogue views, matching the designer's neutral + amber palette. */
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400";

export const buttonSecondary = `rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-200 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-500 disabled:hover:bg-transparent ${focusRing}`;

export const buttonPrimary = `rounded-md bg-amber-400 px-3 py-1.5 text-xs font-medium text-neutral-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500 ${focusRing}`;

export const linkText = `text-amber-300 underline underline-offset-2 hover:text-amber-200 ${focusRing}`;
