"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import ResultsPanel from "@/components/ResultsPanel";
import TopBar from "@/components/TopBar";
import CropLegend from "@/components/CropLegend";
import ScanProgress from "@/components/ScanProgress";
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
  const revealQueueRef = useRef([]);
  const revealTimerRef = useRef(null);

  const [area, setArea] = useState(null);
  const [allBins, setAllBins] = useState([]);
  const [revealedBins, setRevealedBins] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hoveredCounty, setHoveredCounty] = useState(null);
  const [hitTarget, setHitTarget] = useState(false);
  const seedPendingRef = useRef(true);
  const [scanProgress, setScanProgress] = useState([]);

  // Stop the reveal ticker if the component unmounts mid-animation.
  useEffect(() => {
    return () => {
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
    };
  }, []);

  // Feeds newly-arrived bins into a queue and drains it one at a time on a
  // steady tick, WITHOUT touching bins already on screen. This replaces the
  // old approach of clearing + replaying the full `allBins` array on every
  // change, which re-animated every already-revealed bin each time a single
  // new one streamed in from the backend.
  function enqueueReveal(newBins) {
    if (newBins.length === 0) return;
    revealQueueRef.current.push(...newBins);
    if (revealTimerRef.current) return; // ticker already running, it'll pick these up
    revealTimerRef.current = setInterval(() => {
      const next = revealQueueRef.current.shift();
      if (next) setRevealedBins((prev) => [...prev, next]);
      if (revealQueueRef.current.length === 0) {
        clearInterval(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    }, REVEAL_INTERVAL_MS);
  }

  // Called at the top of every scanArea() run: wipes anything left over
  // from the previous scan immediately (rather than waiting on the first
  // bin of the new scan to arrive) and closes the site info panel, since a
  // new scan means the previously-selected bin no longer applies.
  function resetScanState() {
    if (revealTimerRef.current) {
      clearInterval(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    revealQueueRef.current = [];
    setAllBins([]);
    setRevealedBins([]);
    setScanProgress([]);
    setHitTarget(false);
    mapRef.current?.closeSitePanel();
  }

  // Fires the moment a county is clicked, so the circle appears right
  // alongside the popup -- before Scan is even pressed.
  function handleCountyClick({ lat, lng, name, state }) {
    setArea({ label: `${name} County, ${state}`, lat, lng, radiusMiles: 3 });
  }

  // Triggered by the "Scan" button in a county's popup. Returns the bins
  // found so MapCanvas can update that popup's button text in place.
  async function scanArea({ lat, lng, name, state }) {
    setLoading(true);
    resetScanState();
    setArea({ label: `${name} County, ${state}`, lat, lng, radiusMiles: 3 });

    // First-load autopilot demo: served from the local seed file, no network
    // at all, so there's nothing to stream -- resolve it as one instant "bin"
    // event per bin instead, so ScanProgress/ResultsPanel behave the same
    // whether the data came from the seed or a real scan.
    if (seedPendingRef.current) {
      seedPendingRef.current = false;
      try {
        await new Promise((r) => setTimeout(r, 3000)); // stand-in for real scan latency
        const bins = seedScan.bins ?? [];
        setAllBins(bins);
        enqueueReveal(bins);
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

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const bins = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);

          if (event.type === "bin") {
            bins.push(event.bin);
            setAllBins([...bins]);
            enqueueReveal([event.bin]);
          } else if (event.type === "progress") {
            setScanProgress((prev) => [...prev, event]);
          } else if (event.type === "done") {
            setHitTarget(Boolean(event.hitTarget));
          }
        }
      }
      return bins;
    } finally {
      setLoading(false);
      scanControllerRef.current = null;
    }
  }

  function stopScan() {
    scanControllerRef.current?.abort();
  }

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

      {loading && (
        <ScanProgress events={scanProgress} binsFound={allBins.length} />
      )}

      <ResultsPanel
        area={area}
        revealedBins={revealedBins}
        totalBins={allBins.length}
        hitTarget={hitTarget}
        loading={loading}
        onResultClick={handleResultClick}
        onStop={stopScan}
      />

      <CropLegend />
    </>
  );
}
