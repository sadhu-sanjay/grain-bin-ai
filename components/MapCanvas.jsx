"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import * as topojson from "topojson-client";
import { SAT_STYLE } from "@/lib/mapStyles";
import { stateAbbrFromFips } from "@/lib/stateFips";
import circle from "@turf/circle";
import destination from "@turf/destination";
import bbox from "@turf/bbox";
import { getConfidenceTier } from "@/lib/confidence";

// A small grain-bin/silo pictogram used for both the map markers and the
// popup, in place of a plain dot — dome roof + cylindrical body.
const BIN_ICON_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2 L19 7 V19 A7 4 0 0 1 5 19 V7 Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M5 7 A7 4 0 0 0 19 7" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <path d="M5.6 12 H18.4" stroke="currentColor" stroke-width="1" stroke-opacity="0.6"/>
  <path d="M6.3 16 H17.7" stroke="currentColor" stroke-width="1" stroke-opacity="0.6"/>
</svg>`;

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

function MapCanvas({
  bins,
  selectedBinId,
  onCountyHover,
  onCountyClick,
  onScanRequest,
  onStopScan,
  onMapReady,
  initialCenter,
  initialZoom,
  searchArea,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const countyGeoJSON = useRef(null);
  const statesGeoJSON = useRef(null);
  const markersRef = useRef(new Map());
  const hoveredIdRef = useRef(null);
  const selectedIdRef = useRef(null);
  const popupRef = useRef(null);
  const searchCircleRef = useRef(null);
  const isScanningRef = useRef(false);
  const activeScanBtnRef = useRef(null);
  const selectedBinMarkerElRef = useRef(null);
  const annotationMarkerRef = useRef(null);

  const [zoom, setZoom] = useState(initialZoom ?? 4.2);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SAT_STYLE,
      center: initialCenter
        ? [initialCenter.lng, initialCenter.lat]
        : [-95.5, 40.5],
      zoom: initialZoom ?? 4.2,
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
    });

    return () => {
      map.remove();
      mapRef.current = null;
      onMapReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync bin markers with the `bins` prop (append-only reveal animation).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
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
      const tier = getConfidenceTier(bin.confidence);
      const el = document.createElement("div");
      el.className = `bin-marker conf-${tier.key}`;
      el.style.setProperty("--conf-color", tier.color);
      el.innerHTML = BIN_ICON_SVG;
      const pct = Math.round((bin.confidence ?? 0) * 100);
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([bin.lng, bin.lat])
        .setPopup(
          new maplibregl.Popup({ closeButton: false, offset: 16 }).setHTML(
            `<div class="popup-modern">
               <div class="popup-head">
                 <span class="popup-bin-icon">${BIN_ICON_SVG}</span>
                 <span class="popup-title">Detected storage site</span>
               </div>
               <div class="popup-row"><span>Est. capacity</span><span class="mono">${bin.capacityBushels.toLocaleString()} bu</span></div>
               <div class="popup-row popup-row-conf">
                 <span>Confidence</span>
                 <span class="popup-conf-pill conf-${tier.key}" style="--conf-color:${tier.color}">${pct}%</span>
               </div>
               <div class="popup-owner-cta">🔒 Upgrade to Pro for owner info</div>
             </div>`,
          ),
        )
        .addTo(map);
      current.set(bin.id, marker);
    });
  }, [bins]);

  // Highlight + annotate the selected bin: a pulsing ring on its marker
  // plus a floating confidence pill hovering above it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedBinMarkerElRef.current) {
      selectedBinMarkerElRef.current.classList.remove("bin-marker-selected");
      selectedBinMarkerElRef.current = null;
    }
    annotationMarkerRef.current?.remove();
    annotationMarkerRef.current = null;

    if (!selectedBinId) return;
    const marker = markersRef.current.get(selectedBinId);
    const bin = bins.find((b) => b.id === selectedBinId);
    if (!marker || !bin) return;

    const el = marker.getElement();
    el.classList.add("bin-marker-selected");
    selectedBinMarkerElRef.current = el;

    const tier = getConfidenceTier(bin.confidence);
    const pct = Math.round((bin.confidence ?? 0) * 100);
    const annotationEl = document.createElement("div");
    annotationEl.className = "bin-annotation";
    annotationEl.style.setProperty("--conf-color", tier.color);
    annotationEl.innerHTML = `<span class="bin-annotation-dot"></span>${pct}% confidence`;

    annotationMarkerRef.current = new maplibregl.Marker({
      element: annotationEl,
      anchor: "bottom",
      offset: [0, -26],
    })
      .setLngLat([bin.lng, bin.lat])
      .addTo(map);
  }, [selectedBinId, bins]);

  function addAllLayers(map) {
    if (map.getSource("counties")) return;

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
    // map.addLayer({
    //   id: "county-labels",
    //   type: "symbol",
    //   source: "counties",
    //   minzoom: 6.5,
    //   layout: {
    //     "text-field": ["get", "name"],
    //     "text-font": ["Open Sans Regular"],
    //     "text-size": [
    //       "interpolate",
    //       ["linear"],
    //       ["zoom"],
    //       5,
    //       9,
    //       7,
    //       11,
    //       9,
    //       13,
    //       12,
    //       16,
    //     ],
    //     "text-allow-overlap": false,
    //   },
    //   paint: {
    //     "text-color": "#f4efe3",
    //     "text-halo-color": "#000000",
    //     "text-halo-width": 1.4,
    //     "text-halo-blur": 0.4,
    //   },
    // });

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
      if (isScanningRef.current) {
        shakeStopButton();
        return;
      }
      const f = e.features?.[0];
      if (!f) return;

      // any new selection restores the crop layer, in case it was hidden
      // by a previous scan
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
      const countyBbox = bbox(f.geometry); // [minLng, minLat, maxLng, maxLat]

      const popupNode = document.createElement("div");
      popupNode.innerHTML = `
        <div class="popup-title">${name} County, ${state}</div>
        <div class="popup-row"><span>FIPS</span><span class="mono">${f.properties.fips}</span></div>
        <div class="popup-scan-prompt">Scan this area for grain bins</div>
      `;

      const scanBtn = document.createElement("button");
      scanBtn.type = "button";
      scanBtn.className = "popup-scan-btn";
      scanBtn.textContent = "Scan";
      let scanning = false;

      scanBtn.addEventListener("click", async () => {
        if (scanning) {
          onStopScan?.();
          scanning = false;
          isScanningRef.current = false;
          activeScanBtnRef.current = null;
          searchCircleRef.current?.stopSweep();
          return;
        }

        scanning = true;
        isScanningRef.current = true;
        activeScanBtnRef.current = scanBtn;
        scanBtn.textContent = "Stop scan";
        searchCircleRef.current?.startSweep();

        applyCdlTiles(map, {
          lat: e.lngLat.lat,
          lng: e.lngLat.lng,
          radiusMiles: 3,
        });

        try {
          const bins = await onScanRequest?.({
            lat: e.lngLat.lat,
            lng: e.lngLat.lng,
            name,
            state,
          });
          scanBtn.textContent =
            bins?.length > 0 ? `Found ${bins.length}` : "No bins found";
        } catch (err) {
          if (err?.name === "AbortError") {
            scanBtn.textContent = "Scan stopped. Click to retry";
          } else {
            console.error("Scan failed:", err);
            scanBtn.textContent = "Scan failed — retry";
          }
        } finally {
          scanning = false;
          isScanningRef.current = false;
          activeScanBtnRef.current = null;
          searchCircleRef.current?.stopSweep();
        }
      });
      popupNode.appendChild(scanBtn);

      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
      })
        .setLngLat(e.lngLat)
        .setDOMContent(popupNode)
        .addTo(map);

      onCountyClick?.({
        fips: f.properties.fips,
        name,
        state,
        geometry: f.geometry,
        bbox: countyBbox,
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
      });

      searchCircleRef.current?.remove();
      searchCircleRef.current = createSearchCircle(map, e.lngLat, 3);
    });

    map.on("click", (e) => {
      if (isScanningRef.current) {
        shakeStopButton();
        return;
      }
      const hits = map.queryRenderedFeatures(e.point, {
        layers: ["county-fill"],
      });
      if (hits.length === 0) {
        popupRef.current?.remove();
      }
    });
  }

  function shakeStopButton() {
    const btn = activeScanBtnRef.current;
    if (!btn) return;
    btn.classList.remove("shake");
    void btn.offsetWidth; // force reflow so it can replay if already mid-shake
    btn.classList.add("shake");
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
    </>
  );
}

export default MapCanvas;
