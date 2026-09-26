"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import * as topojson from "topojson-client";
import { SAT_STYLE } from "@/lib/mapStyles";
import { stateAbbrFromFips } from "@/lib/stateFips";
import destination from "@turf/destination";
import bbox from "@turf/bbox";
import SiteInfoPanel from "./SiteInfoPanel";

function detectionFeatures(bin) {
  return {
    type: "FeatureCollection",
    features: bin.detections.map((d) => ({
      type: "Feature",
      properties: { confidence: d.confidence ?? 0, primary: d.primary },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [d.bounds.west, d.bounds.north],
            [d.bounds.east, d.bounds.north],
            [d.bounds.east, d.bounds.south],
            [d.bounds.west, d.bounds.south],
            [d.bounds.west, d.bounds.north],
          ],
        ],
      },
    })),
  };
}
const EMPTY_FC = { type: "FeatureCollection", features: [] };

function createSearchCircle(map, lngLat, radiusMiles) {
  const wrapper = document.createElement("div");
  wrapper.className = "radar-scan";
  map.getContainer().appendChild(wrapper);

  function updatePosition() {
    const center = map.project(lngLat);
    const edge = map.project(
      destination([lngLat.lng, lngLat.lat], radiusMiles, 90, { units: "miles" })
        .geometry.coordinates,
    );
    const radiusPx = Math.abs(edge.x - center.x);
    wrapper.style.width = `${radiusPx * 2}px`;
    wrapper.style.height = `${radiusPx * 2}px`;
    wrapper.style.left = `${center.x - radiusPx}px`;
    wrapper.style.top = `${center.y - radiusPx}px`;
  }
  updatePosition();
  map.on("move", updatePosition);

  let sweepEl = null;

  return {
    startSweep() {
      if (sweepEl) return;
      sweepEl = document.createElement("div");
      sweepEl.className = "radar-scan-sweep";
      wrapper.appendChild(sweepEl);
    },
    stopSweep() {
      sweepEl?.remove();
      sweepEl = null;
    },
    remove() {
      map.off("move", updatePosition);
      wrapper.remove();
    },
  };
}

function confidenceTier(c) {
  if (c >= 0.8) return "high";
  if (c >= 0.6) return "medium";
  return "low";
}

function confidenceBadgeHTML(confidence) {
  const pct = Math.round((confidence ?? 0) * 100);
  return `<span class="confidence-badge ${confidenceTier(confidence ?? 0)}">${pct}%</span>`;
}

// Shared close (×) button markup for both popup states below -- actual
// closing is wired up in wireClosePopupButton() via event delegation, so
// it keeps working even after setHTML() swaps this markup back in.
const POPUP_CLOSE_BTN_HTML = `<button type="button" class="popup-close-btn" aria-label="Close">&times;</button>`;

// Lightweight info card -- used for every marker's default popup, no
// image load, so revealing dozens of markers stays cheap.
function binPopupHTML(bin) {
  return `
    <div class="popup-title-row">
      <div class="popup-title">Detected storage site</div>
      ${POPUP_CLOSE_BTN_HTML}
    </div>
    <div class="popup-row"><span>Est. capacity</span><span class="mono">${bin.capacityBushels.toLocaleString()} bu</span></div>
    <div class="popup-row"><span>Confidence</span>${confidenceBadgeHTML(bin.confidence)}</div>
    <button type="button" class="upgrade-owner-btn" title="Upgrade to Pro to unlock owner information">🔒 Upgrade to Pro for owner info</button>
  `;
}

const BIN_ICON_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2 L19 7 V19 A7 4 0 0 1 5 19 V7 Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M5 7 A7 4 0 0 0 19 7" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <path d="M5.6 12 H18.4" stroke="currentColor" stroke-width="1" stroke-opacity="0.6"/>
  <path d="M6.3 16 H17.7" stroke="currentColor" stroke-width="1" stroke-opacity="0.6"/>
</svg>`;

function binMarkerIcon(confidence, siteNum) {
  const el = document.createElement("div");
  el.className = `bin-marker ${confidenceTier(confidence ?? 0)}`;
  el.innerHTML = `${BIN_ICON_SVG}<span class="bin-marker-num">${siteNum}</span>`;
  return el;
}

function MapCanvas({
  bins,
  onCountyHover,
  onCountyClick,
  onScanRequest,
  onStopScan,
  onMapReady,
  initialCenter,
  initialZoom,
  autoplayArea,
  searchArea,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const countyGeoJSON = useRef(null);
  const statesGeoJSON = useRef(null);
  const markersRef = useRef(new Map());
  const binsRef = useRef([]);
  const hoveredIdRef = useRef(null);
  const selectedIdRef = useRef(null);
  const popupRef = useRef(null);
  const searchCircleRef = useRef(null);
  const isScanningRef = useRef(false);

  const [zoom, setZoom] = useState(initialZoom ?? 4.2);
  const [selectedBin, setSelectedBin] = useState(null);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SAT_STYLE,
      center: initialCenter
        ? [initialCenter.lng, initialCenter.lat]
        : [-85.2, 45.5],
      zoom: initialZoom ?? 2.3,
      attributionControl: true,
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );
    mapRef.current = map;
    const updateZoom = () => setZoom(map.getZoom());
    map.on("zoom", updateZoom);
    updateZoom();

    // Hand the API straight to the parent as soon as the map instance
    // exists — a plain callback prop, not a forwarded ref, so this always
    // fires regardless of how MapCanvas itself was loaded/mounted.
    onMapReady?.({
      flyTo(lat, lng, zoom = 9) {
        mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1400 });
      },
      selectBin(bin, zoom = 16.5) {
        selectBin(mapRef.current, bin, zoom);
      },
      closeSitePanel() {
        setSelectedBin(null);
      },
    });

    map.on("load", async () => {
      const topo = await fetch(
        "https://unpkg.com/us-atlas@3/counties-10m.json",
      ).then((r) => r.json());
      const countiesFC = topojson.feature(topo, topo.objects.counties);
      const statesFC = topojson.feature(topo, topo.objects.states);
      countiesFC.features.forEach((f) => {
        f.properties = f.properties || {};
        f.properties.fips = f.id;
      });
      countyGeoJSON.current = countiesFC;
      statesGeoJSON.current = statesFC;
      addAllLayers(map);

      if (autoplayArea) {
        setTimeout(() => {
          map.flyTo({
            center: [autoplayArea.lng, autoplayArea.lat],
            zoom: 9,
            duration: 3000,
          });
          map.once("moveend", () => {
            const point = map.project([autoplayArea.lng, autoplayArea.lat]);
            const hits = map.queryRenderedFeatures(point, {
              layers: ["county-fill"],
            });
            const f = hits[0];
            if (!f) return; // seed location didn't land on a county polygon -- nothing to click

            if (selectedIdRef.current !== null) {
              map.setFeatureState(
                { source: "counties", id: selectedIdRef.current },
                { selected: false },
              );
            }
            selectedIdRef.current = f.id;
            map.setFeatureState(
              { source: "counties", id: f.id },
              { selected: true },
            );

            const name = f.properties.name;
            const state = stateAbbrFromFips(f.properties.fips);
            openScanPopup(
              map,
              new maplibregl.LngLat(autoplayArea.lng, autoplayArea.lat),
              name,
              state,
              900, // auto-click the Scan button after this pause
            );
          });
        }, 600);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      onMapReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closes the "Scan this area" prompt popup once results start coming in.
  // Guarded on isScanningRef: while a scan is actively running, popupRef
  // holds the SAME popup instance as the Stop-scan button (openScanPopup
  // reuses it), so removing it here mid-scan would silently kill the
  // ability to stop the scan the moment the first bin was revealed.
  useEffect(() => {
    if (bins.length > 0 && !isScanningRef.current) {
      popupRef.current?.remove();
    }
  }, [bins]);

  function forwardScrollZoom(map, popup) {
    popup.on("open", () => {
      const el = popup.getElement();
      if (!el) return;
      el.addEventListener("wheel", (e) => map.scrollZoom.wheel(e), {
        passive: true,
      });
    });
  }

  // Wires the in-popup "×" close button via event delegation on the
  // popup's persistent wrapper element -- attached once, so it keeps
  // working even after selectBin() swaps the inner HTML with setHTML().
  function wireClosePopupButton(popup) {
    popup.on("open", () => {
      const el = popup.getElement();
      if (!el || el.dataset.closeWired) return;
      el.dataset.closeWired = "1";
      el.addEventListener("click", (e) => {
        if (e.target.closest(".popup-close-btn")) {
          popup.remove();
        }
      });
    });
  }

  function selectBin(map, bin, zoom = 16.5) {
    const siteNum = Array.from(markersRef.current.keys()).indexOf(bin.id) + 1;
    map.flyTo({ center: [bin.lng, bin.lat], zoom, duration: 1400 });
    map.getSource("bin-detections")?.setData(detectionFeatures(bin));
    setSelectedBin({ ...bin, siteNum });
  }

  // Sync bin markers with the `bins` prop (append-only reveal animation).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    binsRef.current = bins;
    if (bins.length === 0) {
      map.getSource("bin-detections")?.setData(EMPTY_FC);
    }
    const current = markersRef.current;
    const nextIds = new Set(bins.map((b) => b.id));

    // Remove markers no longer present (e.g. a fresh search cleared the old set).
    current.forEach((marker, id) => {
      if (!nextIds.has(id)) {
        marker.remove();
        current.delete(id);
      }
    });

    // Add any newly revealed bins.
    bins.forEach((bin) => {
      if (current.has(bin.id)) return;
      // Same numbering selectBin() computes later (position in insertion
      // order) -- computed here too so the marker shows it immediately.
      const siteNum = current.size + 1;
      const el = binMarkerIcon(bin.confidence, siteNum);
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([bin.lng, bin.lat])
        .addTo(map);

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        popupRef.current?.remove(); // close any lingering "Scan this area" popup
        selectBin(mapRef.current, bin, 16.5); // handles flyTo + detection outline itself
      });

      current.set(bin.id, marker);
    });
  }, [bins]);

  function openScanPopup(map, lngLat, name, state, autoClickDelayMs) {
    const popupNode = document.createElement("div");
    popupNode.innerHTML = `
    <div class="popup-title">${name} County, ${state}</div>
    <div class="popup-scan-prompt">Scan this area for grain bins</div>
  `;

    const scanBtn = document.createElement("button");
    scanBtn.type = "button";
    scanBtn.className = "popup-scan-btn";
    scanBtn.textContent = "Scan";
    let scanning = false;

    scanBtn.addEventListener("click", async () => {
      isScanningRef.current = true;
      searchCircleRef.current?.startSweep();
      popupRef.current?.remove(); // scan starts -- stopping now happens from the ScanProgress panel, not here

      applyCdlTiles(map, { lat: lngLat.lat, lng: lngLat.lng, radiusMiles: 12 });

      try {
        await onScanRequest?.({
          lat: lngLat.lat,
          lng: lngLat.lng,
          name,
          state,
        });
      } catch (err) {
        if (err?.name !== "AbortError") console.error("Scan failed:", err);
      } finally {
        isScanningRef.current = false;
        searchCircleRef.current?.stopSweep();
      }
    });
    popupNode.appendChild(scanBtn);

    popupRef.current?.remove();
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
    })
      .setLngLat(lngLat)
      .setDOMContent(popupNode)
      .addTo(map);
    forwardScrollZoom(map, popupRef.current);

    searchCircleRef.current?.remove();
    searchCircleRef.current = createSearchCircle(map, lngLat, 12);

    if (autoClickDelayMs) {
      setTimeout(() => scanBtn.click(), autoClickDelayMs);
    }
  }

  function addAllLayers(map) {
    if (map.getSource("counties")) return;

    map.addSource("bin-detections", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: "bin-detections-fill",
      type: "fill",
      source: "bin-detections",
      paint: {
        "fill-color": ["case", ["get", "primary"], "#c9a227", "#e0362f"],
        "fill-opacity": 0.22,
      },
    });

    map.addLayer({
      id: "bin-detections-outline",
      type: "line",
      source: "bin-detections",
      paint: {
        "line-color": ["case", ["get", "primary"], "#c9a227", "#e0362f"],
        "line-width": 2,
      },
    });

    map.addLayer({
      id: "bin-detections-label",
      type: "symbol",
      source: "bin-detections",
      layout: {
        "text-field": [
          "concat",
          ["to-string", ["round", ["*", ["get", "confidence"], 100]]],
          "%",
        ],
        "text-font": ["Open Sans Bold"],
        "text-size": 11,
        "text-offset": [0, -1.1],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": ["case", ["get", "primary"], "#c9a227", "#e0362f"],
        "text-halo-color": "#000",
        "text-halo-width": 1.4,
      },
    });

    // Every US county, all the time — no fake per-county data, no subset.
    // `promoteId` turns each feature's `fips` property into its GeoJSON
    // feature id, which is what lets setFeatureState() drive hover/select
    // highlighting per county below.
    map.addSource("counties", {
      type: "geojson",
      data: countyGeoJSON.current,
      promoteId: "fips",
    });
    map.addSource("states", { type: "geojson", data: statesGeoJSON.current });

    // Base outlines — always on, every county nationwide.
    // map.addLayer({
    //   id: "county-outlines-all",
    //   type: "line",
    //   source: "counties",
    //   paint: { "line-color": "rgba(237,230,214,0.35)", "line-width": 0.6 },
    // });
    map.addLayer({
      id: "state-outlines-all",
      type: "line",
      source: "states",
      paint: { "line-color": "rgba(237,230,214,0.55)", "line-width": 1.1 },
    });

    map.addLayer({
      id: "state-labels",
      type: "symbol",
      source: "states",
      minzoom: 4,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Regular"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          2,
          10,
          4,
          12,
          6,
          14,
          8,
          16,
        ],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.08,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "rgba(255,255,255,0.82)",
        "text-halo-color": "rgba(0,0,0,0.7)",
        "text-halo-width": 1.5,
        "text-halo-blur": 0.4,
      },
    });

    // Invisible hit layer for mouse events across every county — stays
    // fully transparent always. Only the outline layer below shows a
    // visual highlight now.
    map.addLayer({
      id: "county-fill",
      type: "fill",
      source: "counties",
      paint: {
        "fill-color": "#ede6d6",
        "fill-opacity": 0,
      },
    });

    // Brighter outline drawn only on the hovered/selected county.
    map.addLayer({
      id: "county-outline-active",
      type: "line",
      source: "counties",
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#c9a227",
          "#ede6d6",
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          2.6,
          ["boolean", ["feature-state", "hover"], false],
          2,
          0,
        ],
        "line-opacity": [
          "case",
          [
            "any",
            ["boolean", ["feature-state", "selected"], false],
            ["boolean", ["feature-state", "hover"], false],
          ],
          1,
          0,
        ],
      },
    });

    // County name labels, readable over the satellite/crop tiles underneath.
    map.addLayer({
      id: "county-labels",
      type: "symbol",
      source: "counties",
      minzoom: 6.5,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Regular"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          9,
          7,
          11,
          9,
          13,
          12,
          16,
        ],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#f4efe3",
        "text-halo-color": "#000000",
        "text-halo-width": 1.4,
        "text-halo-blur": 0.4,
      },
    });

    applyCdlTiles(map);

    map.on("mouseenter", "county-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mousemove", "county-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      if (hoveredIdRef.current !== null && hoveredIdRef.current !== f.id) {
        map.setFeatureState(
          { source: "counties", id: hoveredIdRef.current },
          { hover: false },
        );
      }
      if (hoveredIdRef.current !== f.id) {
        hoveredIdRef.current = f.id;
        map.setFeatureState({ source: "counties", id: f.id }, { hover: true });
        onCountyHover?.({
          fips: f.properties.fips,
          name: f.properties.name,
          state: stateAbbrFromFips(f.properties.fips),
        });
      }
    });

    map.on("mouseleave", "county-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredIdRef.current !== null) {
        map.setFeatureState(
          { source: "counties", id: hoveredIdRef.current },
          { hover: false },
        );
        hoveredIdRef.current = null;
      }
      onCountyHover?.(null);
    });

    map.on("click", "county-fill", (e) => {
      if (isScanningRef.current) return;

      const f = e.features?.[0];
      if (!f) return;

      if (map.getLayer("nass-cdl-layer")) {
        map.setLayoutProperty("nass-cdl-layer", "visibility", "visible");
      }
      if (selectedIdRef.current !== null) {
        map.setFeatureState(
          { source: "counties", id: selectedIdRef.current },
          { selected: false },
        );
      }
      selectedIdRef.current = f.id;
      map.setFeatureState({ source: "counties", id: f.id }, { selected: true });

      const name = f.properties.name;
      const state = stateAbbrFromFips(f.properties.fips);
      openScanPopup(map, e.lngLat, name, state);

      onCountyClick?.({
        fips: f.properties.fips,
        name,
        state,
        geometry: f.geometry,
        bbox: bbox(f.geometry),
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
      });
    });

    map.on("click", (e) => {
      if (isScanningRef.current) return;
      const hits = map.queryRenderedFeatures(e.point, {
        layers: ["county-fill"],
      });
      if (hits.length === 0) {
        popupRef.current?.remove();
      }
    });
  }

  // add near the top of the component, above addAllLayers
  function applyCdlTiles(map, params) {
    const qs = params
      ? `?lat=${params.lat}&lng=${params.lng}&radiusMiles=${params.radiusMiles}`
      : "";

    fetch(`/api/cdl-tiles${qs}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.urlFormat) return;
        const existing = map.getSource("nass-cdl");
        if (existing) {
          existing.setTiles([data.urlFormat]); // swaps tiles in place, no re-add
        } else {
          map.addSource("nass-cdl", {
            type: "raster",
            tiles: [data.urlFormat],
            tileSize: 256,
            attribution: "USDA NASS CDL / Google Earth Engine",
          });
          map.addLayer(
            {
              id: "nass-cdl-layer",
              type: "raster",
              source: "nass-cdl",
              paint: { "raster-opacity": 0.75 },
            },
            "state-labels",
          );
        }
      })
      .catch((err) => console.error("Failed to load CDL tiles:", err));
  }

  return (
    <>
      <div ref={containerRef} id="map" />
      <div className="map-zoom-badge">Zoom {zoom.toFixed(1)}x</div>
      {selectedBin && (
        <SiteInfoPanel bin={selectedBin} onClose={() => setSelectedBin(null)} />
      )}
    </>
  );
}

export default MapCanvas;
