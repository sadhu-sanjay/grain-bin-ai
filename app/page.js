"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import ResultsPanel from "@/components/ResultsPanel";
import TopBar from "@/components/TopBar";
import CropLegend from "@/components/CropLegend";

// MapLibre touches `window`, so the map must be client-only, loaded with no SSR.
const MapCanvas = dynamic(() => import("@/components/MapCanvas"), {
  ssr: false,
});

// Pre-loaded on first visit so a new user sees real results immediately,
// with no search required. Casselton, ND — a real grain-elevator town in
// Cass County, ND, so the map zooms straight to an actual place instead of
// an empty county centroid, and the detected bins drop in right around it.
const DEFAULT_AREA = {
  label: "Casselton, ND",
  lat: 46.8996,
  lng: -97.2136,
  radiusMiles: 25,
};

const REVEAL_INTERVAL_MS = 90;

export default function Home() {
  const mapRef = useRef(null);
  const scanControllerRef = useRef(null);

  const [area, setArea] = useState(null);
  const [allBins, setAllBins] = useState([]);
  const [revealedBins, setRevealedBins] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hoveredCounty, setHoveredCounty] = useState(null);
  const [hitTarget, setHitTarget] = useState(false);
  

  // Fires the moment a county is clicked, so the circle appears right
  // alongside the popup -- before Scan is even pressed.
  function handleCountyClick({ lat, lng, name, state }) {
    setArea({ label: `${name} County, ${state}`, lat, lng, radiusMiles: 3 });
  }

  // Triggered by the "Scan" button in a county's popup. Returns the bins
  // found so MapCanvas can update that popup's button text in place.
  async function scanArea({ lat, lng, name, state }) {
    setLoading(true);
    setRevealedBins([]);
    setAllBins([]);
    setHitTarget(false);
    setArea({ label: `${name} County, ${state}`, lat, lng, radiusMiles: 3 });

    const controller = new AbortController();
    scanControllerRef.current = controller;

    try {
      const res = await fetch("/api/scan-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon: lng, boxMiles: 6 }),
        signal: controller.signal,
      });
      const data = await res.json();
      const bins = data.bins ?? [];
      setAllBins(bins);
      setHitTarget(Boolean(data.hitTarget));
      return bins;
    } finally {
      setLoading(false);
      scanControllerRef.current = null;
    }
  }

  function stopScan() {
    scanControllerRef.current?.abort();
  }

  async function runDetection(nextArea, flyTo = true) {
    setLoading(true);
    setRevealedBins([]);
    setAllBins([]);
    setArea(nextArea);

    if (flyTo) mapRef.current?.flyTo(nextArea.lat, nextArea.lng, 9);

    try {
      const res = await fetch("/api/detect-bins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextArea),
      });
      const data = await res.json();
      setAllBins(data.bins);
    } finally {
      setLoading(false);
    }
  }

  // Auto-run detection on the default area the moment the app loads —
  // this is a real (mocked) detection call, not hard-coded pins.
  useEffect(() => {
    runDetection(DEFAULT_AREA, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop-in reveal animation: append one bin at a time from `allBins`.
  useEffect(() => {
    if (allBins.length === 0) return;
    setRevealedBins([]);
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setRevealedBins(allBins.slice(0, i));
      if (i >= allBins.length) clearInterval(interval);
    }, REVEAL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [allBins]);

  function handleSearch(lat, lng, label) {
    runDetection({ label, lat, lng, radiusMiles: 25 });
  }

  function handleResultClick(bin) {
    mapRef.current?.selectBin(bin, 18.4);
  }

  return (
    <>
      <MapCanvas
        onMapReady={(api) => {
          mapRef.current = api;
        }}
        bins={revealedBins}
        onCountyHover={setHoveredCounty}
        initialCenter={{ lat: DEFAULT_AREA.lat, lng: DEFAULT_AREA.lng }}
        initialZoom={9}
        searchArea={area}
        onScanRequest={scanArea}
        onStopScan={stopScan}
        onCountyClick={handleCountyClick}
      />

      <TopBar
        onSearch={handleSearch}
        hoveredCounty={hoveredCounty}
        searching={loading}
      />

      <ResultsPanel
        area={area}
        revealedBins={revealedBins}
        totalBins={allBins.length}
        hitTarget={hitTarget}
        loading={loading}
        onResultClick={handleResultClick}
      />

      <CropLegend />
    </>
  );
}
