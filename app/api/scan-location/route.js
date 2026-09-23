import { NextResponse } from "next/server";
import { getBuildingsInBbox } from "@/lib/microsoftBuildings";
import { clusterFarmsteads } from "@/lib/clusterFarmsteads";
import { getNaipChipUrl } from "@/lib/naipChip";
import { detectBinsInChip } from "@/lib/roboflowDetect";
import { estimateCapacityBushels } from "@/lib/estimateCapacity";

const MILES_TO_KM = 1.60934;
const KM_PER_DEG_LAT = 110.574; // ~constant everywhere

const DEFAULT_BOX_MILES = 6;
const MAX_CHIPS = 5; // hard cap on Roboflow calls per scan, regardless of hits

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
  const buildings = await getBuildingsInBbox(bbox, req.singal);
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

  // 3. scan candidates ONE AT A TIME, up to MAX_CHIPS total -- this caps
  //    how many Roboflow calls a single scan can ever make, regardless of
  //    how many candidates were found or how many turn out to be bins.
  const chipsToScan = candidates.slice(0, MAX_CHIPS);
  console.log(
    `[scan] step 4/4: sending ${chipsToScan.length} of ${candidates.length} candidates to Roboflow (cap=${MAX_CHIPS})`,
  );

  const bins = [];
  let candidatesScanned = 0;

  for (const candidate of chipsToScan) {
    if (req.signal.aborted) {
      console.log("[scan] client aborted — stopping before further chips");
      break;
    }
    candidatesScanned++;
    const label = `candidate ${candidatesScanned}/${chipsToScan.length} (lat=${candidate.lat.toFixed(5)}, lon=${candidate.lon.toFixed(5)})`;

    try {
      console.log(`[scan]   [${label}] fetching NAIP chip...`);
      const chip = await getNaipChipUrl(candidate.lon, candidate.lat);
      console.log(`[scan]   [${label}] chip ready: ${chip.url}`);

      console.log(`[scan]   [${label}] calling Roboflow...`);
      const rfStart = Date.now();
      const result = await detectBinsInChip(chip.url);
      const predictions = result?.predictions ?? [];
      console.log(
        `[scan]   [${label}] Roboflow responded: ${predictions.length} prediction(s) (${Date.now() - rfStart}ms)`,
      );

      // one marker per CHIP, not per prediction -- if Roboflow found
      // multiple bins in the same chip, we still only place one marker
      // at this candidate's location, using the highest-confidence hit.
      if (predictions.length > 0) {
        const best = predictions.reduce((a, b) =>
          (b.confidence ?? 0) > (a.confidence ?? 0) ? b : a,
        );

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
          detectionCount: predictions.length, // how many bins Roboflow actually found in this chip
        });
      }
    } catch (err) {
      // one bad chip/candidate shouldn't kill the whole scan -- log and move on
      console.error(`[scan]   [${label}] FAILED:`, err);
    }
  }

  console.log(
    `[scan] complete: ${candidatesScanned} chip(s) sent, ${bins.length} bin(s) returned`,
  );

  return NextResponse.json({
    area: { lat, lng: lon, boxMiles: box },
    candidatesFound: candidates.length,
    candidatesScanned,
    bins,
  });
}
