import { NextResponse } from "next/server";
import { getBuildingsInBbox } from "@/lib/microsoftBuildings";
import { clusterFarmsteads } from "@/lib/clusterFarmsteads";
import { getNaipChipUrl } from "@/lib/naipChip";
import { detectBinsInChip } from "@/lib/roboflowDetect";
import { estimateCapacityBushels } from "@/lib/estimateCapacity";
import { pixelBoxToGeoBox } from "@/lib/pixelToGeo";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const MILES_TO_KM = 1.60934;
const KM_PER_DEG_LAT = 110.574; // ~constant everywhere

const DEFAULT_BOX_MILES = 6;
const TARGET_BINS = 5; // keep scanning candidates until we have at least this many
const MAX_CANDIDATES_TO_SCAN = 25; // hard safety ceiling on Roboflow calls per scan

function bboxAroundPoint(lon, lat, boxMiles) {
  const kmPerDegLon = 111.32 * Math.cos((lat * Math.PI) / 180);
  const halfBoxKm = (boxMiles / 2) * MILES_TO_KM;
  const dLat = halfBoxKm / KM_PER_DEG_LAT;
  const dLon = halfBoxKm / kmPerDegLon;
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat]; // west, south, east, north
}

export async function POST(req) {
  const body = await req.json();
  const { lat, lon, boxMiles } = body ?? {};

  console.log(
    `[scan] request received: lat=${lat} lon=${lon} boxMiles=${boxMiles ?? DEFAULT_BOX_MILES}`,
  );

  if (typeof lat !== "number" || typeof lon !== "number") {
    console.log("[scan] rejected: lat/lon missing or not numbers");
    return NextResponse.json(
      { error: "lat and lon (numbers) are required" },
      { status: 400 },
    );
  }

  const box = typeof boxMiles === "number" ? boxMiles : DEFAULT_BOX_MILES;
  const bbox = bboxAroundPoint(lon, lat, box);
  console.log(
    `[scan] step 1/4: bbox computed = [${bbox.map((n) => n.toFixed(5)).join(", ")}]`,
  );

  // 1. buildings inside the box -- Microsoft quadkey tile fetch, filtered to bbox
  console.log("[scan] step 2/4: querying Microsoft buildings in bbox...");
  const buildingsStart = Date.now();
  const buildings = await getBuildingsInBbox(bbox, req.signal);
  console.log(
    `[scan] step 2/4 done: ${buildings.length} buildings found (${Date.now() - buildingsStart}ms)`,
  );

  // 2. cluster into farmstead-scale candidates (3-15 buildings, 100m proximity)
  console.log(
    "[scan] step 3/4: clustering buildings (DBSCAN eps=100m, size 3-15)...",
  );
  const candidates = clusterFarmsteads(buildings, bbox);
  console.log(
    `[scan] step 3/4 done: ${candidates.length} farmstead candidates found`,
  );
  candidates.forEach((c, i) =>
    console.log(
      `  candidate ${i + 1}: lat=${c.lat.toFixed(5)} lon=${c.lon.toFixed(5)} buildings=${c.buildingCount}`,
    ),
  );

  // 3. scan candidates ONE AT A TIME until we hit TARGET_BINS results or
  //    run out of candidates (or a hard safety ceiling) -- NOT a fixed
  //    chip count. A candidate only counts toward the target if it
  //    actually produced a bin; empty chips don't.
  console.log(
    `[scan] step 4/4: scanning up to ${Math.min(candidates.length, MAX_CANDIDATES_TO_SCAN)} of ${candidates.length} candidate(s), target ${TARGET_BINS} bin(s)`,
  );

  const bins = [];
  let candidatesScanned = 0;

  for (const candidate of candidates) {
    if (bins.length >= TARGET_BINS) break;
    if (candidatesScanned >= MAX_CANDIDATES_TO_SCAN) break;
    if (req.signal.aborted) {
      console.log("[scan] client aborted — stopping before further chips");
      break;
    }

    candidatesScanned++;
    const label = `candidate ${candidatesScanned} (lat=${candidate.lat.toFixed(5)}, lon=${candidate.lon.toFixed(5)})`;

    try {
      console.log(`[scan]   [${label}] fetching NAIP chip...`);
      const chip = await getNaipChipUrl(candidate.lon, candidate.lat);
      console.log(`[scan]   [${label}] chip ready: ${chip.url}`);

      console.log(`[scan]   [${label}] calling Roboflow...`);
      const rfStart = Date.now();
      const result = await detectBinsInChip(chip.url, req.signal);
      const allPredictions = result?.predictions ?? [];

      // The model also flags sheds -- those aren't storage capacity and
      // shouldn't count as a result or show up in the list at all.
      const predictions = allPredictions.filter(
        (p) => (p.class ?? "").toLowerCase() !== "shed",
      );
      console.log(
        `[scan]   [${label}] Roboflow responded: ${allPredictions.length} detection(s), ${predictions.length} after dropping sheds (${Date.now() - rfStart}ms)`,
      );

      // one marker per CHIP, not per prediction -- if Roboflow found
      // multiple bins in the same chip, we still only place one marker
      // at this candidate's location, using the highest-confidence hit.
      // All non-shed boxes for the chip are kept on the bin too, so the
      // annotated view can show every bin found there, not just the best.
      if (predictions.length > 0) {
        const best = predictions.reduce((a, b) =>
          (b.confidence ?? 0) > (a.confidence ?? 0) ? b : a,
        );

        const geoBoxFor = (p) =>
          pixelBoxToGeoBox(p, chip.bounds, chip.chipSizeDeg, chip.dimensionsPx);

        bins.push({
          id: `${candidate.lat.toFixed(5)},${candidate.lon.toFixed(5)}`,
          lat: candidate.lat,
          lng: candidate.lon,
          confidence: best.confidence ?? null,
          capacityBushels: estimateCapacityBushels(best, {
            chipSizeDeg: chip.chipSizeDeg,
            dimensionsPx: chip.dimensionsPx,
            centerLat: candidate.lat,
          }),
          buildingCount: candidate.buildingCount,
          detectionCount: predictions.length,
          // real-world rectangles for every non-shed detection in this
          // chip, best one first -- no image, no pixel coords needed
          // downstream at all.
          detections: [best, ...predictions.filter((p) => p !== best)].map(
            (p, idx) => ({
              bounds: geoBoxFor(p),
              confidence: p.confidence ?? null,
              primary: idx === 0,
            }),
          ),
        });
      }
    } catch (err) {
      // one bad chip/candidate shouldn't kill the whole scan -- log and move on
      console.error(`[scan]   [${label}] FAILED:`, err);
    }
  }

  const hitTarget = bins.length >= TARGET_BINS;
  console.log(
    `[scan] complete: ${candidatesScanned} chip(s) sent, ${bins.length} bin(s) returned, hitTarget=${hitTarget}`,
  );

  const resultPayload = {
    scannedAt: new Date().toISOString(),
    area: { lat, lng: lon, boxMiles: box },
    candidatesFound: candidates.length,
    candidatesScanned,
    bins,
    hitTarget,
  };

  return NextResponse.json(resultPayload);
}
