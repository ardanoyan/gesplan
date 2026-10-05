"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode, ValidateNotSelfIntersecting, type GeoJSONStoreFeatures } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { LonLat } from "@/lib/geo/types";

export type DrawMode = "select" | "roof" | "obstacle";
export type ShapeKind = "roof" | "obstacle";

/** A finished polygon from the canvas; `ring` is open (no repeated closing vertex), WGS84. */
export interface DrawnShape {
  id: string;
  kind: ShapeKind;
  ring: LonLat[];
}

export interface MapCanvasHandle {
  setMode(mode: DrawMode): void;
  removeShape(id: string): void;
  clearAll(): void;
  flyTo(lon: number, lat: number, zoom?: number): void;
  select(id: string): void;
  /** Removes the currently selected shape; returns false when nothing was selected. */
  deleteSelected(): boolean;
}

interface Props {
  initialFeatures: GeoJSONStoreFeatures[] | null;
  modules: GeoJSON.FeatureCollection;
  onShapesChange(shapes: DrawnShape[], raw: GeoJSONStoreFeatures[]): void;
  onSelectionChange(id: string | null): void;
  onModeChange(mode: DrawMode): void;
  /** Called when a roof or obstacle cannot be closed because its edges cross. */
  onDrawRejected?(reason: "self-intersecting"): void;
}

// Esri World Imagery works without a key and is fine for a local prototype; production needs a
// licensed provider behind an adapter (MapTiler or Mapbox, see docs/08-data-sources.md).
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: "raster",
      tiles: [SATELLITE_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Uydu görüntüsü: Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "satellite", type: "raster", source: "satellite" }],
};

const TURKEY_CENTER: LonLat = [35.2, 39.0];

// MapLibre's built-in UI strings are English; these cover the controls this map shows.
const MAP_LOCALE: Record<string, string> = {
  "Map.Title": "Tasarım haritası",
  "NavigationControl.ZoomIn": "Yakınlaştır",
  "NavigationControl.ZoomOut": "Uzaklaştır",
  "AttributionControl.ToggleAttribution": "Kaynakları göster/gizle",
};

// Served from public/ by scripts/copy-maplibre-worker.mjs (bundling breaks MapLibre's own lookup).
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

function isShapeKind(v: unknown): v is ShapeKind {
  return v === "roof" || v === "obstacle";
}

// Terra Draw keeps UI state such as `selected` in feature properties; only the mode belongs in a save.
function stripDrawState(f: GeoJSONStoreFeatures): GeoJSONStoreFeatures {
  return { type: "Feature", id: f.id, geometry: f.geometry, properties: { mode: f.properties?.mode ?? null } };
}

function toShapes(features: GeoJSONStoreFeatures[], finished: Set<string>): { shapes: DrawnShape[]; raw: GeoJSONStoreFeatures[] } {
  const shapes: DrawnShape[] = [];
  const raw: GeoJSONStoreFeatures[] = [];
  for (const f of features) {
    const id = String(f.id);
    const kind = f.properties?.mode;
    if (f.geometry.type !== "Polygon" || !isShapeKind(kind) || !finished.has(id)) continue;
    const ring = (f.geometry.coordinates[0] as number[][]).map((p) => [p[0], p[1]] as LonLat);
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
    if (ring.length < 3) continue;
    shapes.push({ id, kind, ring });
    raw.push(stripDrawState(f));
  }
  return { shapes, raw };
}

const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const finishedRef = useRef<Set<string>>(new Set());
  const selectedRef = useRef<string | null>(null);
  // Set when the design is reset before the map has loaded, so the load handler does not restore it.
  const clearedBeforeLoadRef = useRef(false);
  const loadedRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  useImperativeHandle(ref, () => ({
    setMode(mode) {
      const draw = drawRef.current;
      if (!draw) return;
      draw.setMode(mode);
      propsRef.current.onModeChange(mode);
    },
    removeShape(id) {
      const draw = drawRef.current;
      if (draw?.hasFeature(id)) draw.removeFeatures([id]);
    },
    clearAll() {
      const draw = drawRef.current;
      if (draw) draw.clear();
      else clearedBeforeLoadRef.current = true;
      finishedRef.current.clear();
      selectedRef.current = null;
      propsRef.current.onShapesChange([], []);
      propsRef.current.onSelectionChange(null);
    },
    flyTo(lon, lat, zoom = 18) {
      mapRef.current?.flyTo({ center: [lon, lat], zoom, essential: true });
    },
    select(id) {
      const draw = drawRef.current;
      if (!draw?.hasFeature(id)) return;
      if (draw.getMode() !== "select") {
        draw.setMode("select");
        propsRef.current.onModeChange("select");
      }
      draw.selectFeature(id);
    },
    deleteSelected() {
      const draw = drawRef.current;
      const id = selectedRef.current;
      if (!draw || id === null || !draw.hasFeature(id)) return false;
      draw.removeFeatures([id]);
      selectedRef.current = null;
      propsRef.current.onSelectionChange(null);
      return true;
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE,
      center: TURKEY_CENTER,
      zoom: 5.3,
      maxZoom: 21,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      locale: MAP_LOCALE,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");

    const sync = () => {
      const draw = drawRef.current;
      if (!draw) return;
      const { shapes, raw } = toShapes(draw.getSnapshot(), finishedRef.current);
      propsRef.current.onShapesChange(shapes, raw);
    };

    map.on("load", () => {
      map.addSource("gp-modules", { type: "geojson", data: propsRef.current.modules });
      map.addLayer({
        id: "gp-modules-fill",
        type: "fill",
        source: "gp-modules",
        paint: { "fill-color": "#1e3a8a", "fill-opacity": 0.88 },
      });
      map.addLayer({
        id: "gp-modules-line",
        type: "line",
        source: "gp-modules",
        paint: { "line-color": "#bfdbfe", "line-width": ["interpolate", ["linear"], ["zoom"], 16, 0.3, 20, 1.2] },
      });

      // Only the closing step is checked. While points are still being placed the ring runs back to the
      // first point, and that closing edge can cross earlier edges on the way to a valid polygon.
      const notSelfIntersecting = (feature: GeoJSONStoreFeatures, context: { updateType: string }) => {
        if (context.updateType !== "finish") return { valid: true };
        const result = ValidateNotSelfIntersecting(feature);
        if (!result.valid) propsRef.current.onDrawRejected?.("self-intersecting");
        return result;
      };

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({
            modeName: "roof",
            snapping: { toCoordinate: true },
            validation: notSelfIntersecting,
            styles: {
              fillColor: "#f59e0b",
              fillOpacity: 0.12,
              outlineColor: "#fbbf24",
              outlineWidth: 2,
              closingPointColor: "#fbbf24",
              closingPointOutlineColor: "#111827",
            },
          }),
          new TerraDrawPolygonMode({
            modeName: "obstacle",
            snapping: { toCoordinate: true },
            validation: notSelfIntersecting,
            styles: {
              fillColor: "#ef4444",
              fillOpacity: 0.35,
              outlineColor: "#f87171",
              outlineWidth: 2,
              closingPointColor: "#f87171",
              closingPointOutlineColor: "#111827",
            },
          }),
          new TerraDrawSelectMode({
            // Deleting is left to the app (deleteSelected), which also handles Backspace and works when the
            // map does not have focus. Vertex drags that would cross an edge are refused by select mode itself.
            keyEvents: { deselect: "Escape", delete: null, rotate: ["Control", "r"], scale: ["Control", "s"] },
            flags: {
              roof: { feature: { coordinates: { draggable: true, midpoints: true, deletable: true, snappable: true } } },
              obstacle: {
                feature: { draggable: true, coordinates: { draggable: true, midpoints: true, deletable: true, snappable: true } },
              },
            },
            styles: {
              selectedPolygonColor: "#38bdf8",
              selectedPolygonFillOpacity: 0.12,
              selectedPolygonOutlineColor: "#38bdf8",
              selectedPolygonOutlineWidth: 3,
              selectionPointColor: "#38bdf8",
              selectionPointOutlineColor: "#0f172a",
              midPointColor: "#e0f2fe",
            },
          }),
        ],
      });
      draw.start();
      draw.setMode("select");
      drawRef.current = draw;

      // Older saves can still carry `selected: true`, which would draw a shape as selected when it is not.
      const initial = clearedBeforeLoadRef.current ? null : propsRef.current.initialFeatures?.map(stripDrawState);
      if (initial && initial.length > 0) {
        const results = draw.addFeatures(initial);
        results.forEach((r) => {
          if (r.valid) finishedRef.current.add(String(r.id));
        });
        const coords = initial.flatMap((f) => (f.geometry.type === "Polygon" ? (f.geometry.coordinates[0] as number[][]) : []));
        if (coords.length > 0) {
          const xs = coords.map((c) => c[0]);
          const ys = coords.map((c) => c[1]);
          map.fitBounds(
            [
              [Math.min(...xs), Math.min(...ys)],
              [Math.max(...xs), Math.max(...ys)],
            ],
            { padding: 80, duration: 0, maxZoom: 19 },
          );
        }
      }

      draw.on("finish", (id, context) => {
        finishedRef.current.add(String(id));
        if (context.action === "draw" && isShapeKind(context.mode)) {
          draw.setMode("select");
          draw.selectFeature(id);
          propsRef.current.onModeChange("select");
        }
        sync();
      });
      draw.on("change", (ids, type) => {
        if (type === "delete") {
          ids.forEach((id) => finishedRef.current.delete(String(id)));
          sync();
        }
      });
      draw.on("select", (id) => {
        selectedRef.current = String(id);
        propsRef.current.onSelectionChange(String(id));
      });
      draw.on("deselect", () => {
        selectedRef.current = null;
        propsRef.current.onSelectionChange(null);
      });

      loadedRef.current = true;
      sync();
    });

    return () => {
      loadedRef.current = false;
      try {
        drawRef.current?.stop();
      } catch {
        // the draw instance may not have started if the map never loaded
      }
      drawRef.current = null;
      selectedRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const src = map.getSource("gp-modules") as GeoJSONSource | undefined;
    src?.setData(props.modules);
  }, [props.modules]);

  return <div ref={containerRef} className="h-full w-full" />;
});

export default MapCanvas;
