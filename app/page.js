"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import ResultsPanel from "@/components/ResultsPanel";
import TopBar from "@/components/TopBar";
import CropLegend from "@/components/CropLegend";
import seedScan from "@/data/seed-scan.json";

// MapLibre touches `window`, so the map must be client-only, loaded with no SSR.
const MapCanvas = dynamic(() => import("@/components/MapCanvas"), {
  ssr: false,
});

// Starting position now comes directly from the shipped scan result,
// not a hardcoded location.
const DEFAULT_AREA = {
  label: "Scanned area",
  lat: seedScan.area.lat,
  lng: seedScan.area.lng,
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
  const seedPendingRef = useRef(true);

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

    if (seedPendingRef.current) {
      seedPendingRef.current = false;
      try {
        await new Promise((r) => setTimeout(r, 3000)); // stand-in for real scan latency
        const bins = seedScan.bins ?? [];
        setAllBins(bins);
        setHitTarget(Boolean(seedScan.hitTarget));
        return bins;
      } finally {
        setLoading(false);
        scanControllerRef.current = null;
      }
    }

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
    setArea({ label, lat, lng, radiusMiles: 25 });
    mapRef.current?.flyTo(lat, lng, 9);
  }

  function handleResultClick(bin) {
    mapRef.current?.selectBin(bin, 16.4);
  }

  return (
    <>
      <MapCanvas
        onMapReady={(api) => {
          mapRef.current = api;
        }}
        bins={revealedBins}
        onCountyHover={setHoveredCounty}
        autoplayArea={DEFAULT_AREA}
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
