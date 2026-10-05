import type { Metadata } from "next";
import Link from "next/link";
import PanelBrowser from "@/components/catalog/PanelBrowser";

export const metadata: Metadata = {
  title: "Paneller · GESPlan Prototip",
  description: "Modül kataloğu: panellere göz atın, filtreleyin ve karşılaştırın.",
};

// Standalone catalogue; it reads no saved design, so it works on a fresh browser too.
export default function PanellerPage() {
  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100">
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-5">
        <nav aria-label="Sayfa" className="mb-4">
          <Link
            href="/"
            className="text-sm text-neutral-300 underline-offset-2 hover:text-neutral-100 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <span aria-hidden="true">← </span>Tasarıma dön
          </Link>
        </nav>
        <PanelBrowser mode="page" />
      </div>
    </main>
  );
}
