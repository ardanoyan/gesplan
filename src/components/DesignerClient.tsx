"use client";

import dynamic from "next/dynamic";

// MapLibre and Terra Draw touch `window` at import time, so the designer renders on the client only.
const Designer = dynamic(() => import("./Designer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center bg-neutral-950 text-sm text-neutral-400">Harita yükleniyor…</div>
  ),
});

export default function DesignerClient() {
  return <Designer />;
}
