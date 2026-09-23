import { NextResponse } from "next/server";
import { getBuildingsInBbox } from "@/lib/microsoftBuildings";
import { clusterFarmsteads } from "@/lib/clusterFarmsteads";
import { getNaipChipUrl } from "@/lib/naipChip";
import { detectBinsInChip } from "@/lib/roboflowDetect";
import { estimateCapacityBushels } from "@/lib/estimateCapacity";

const MILES_TO_KM = 1.60934;
const KM_PER_DEG_LAT = 110.574; // ~constant everywhere

const DEFAULT_BOX_MILES = 6;
const TARGET_BINS = 5; // keep sending chips until we've found this many real bins...
const MAX_CANDIDATES_SAFETY = 40; // ...or run out of candidates, or hit this hard safety ceiling

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

  // 3. scan candidates ONE AT A TIME -- keep sending chips to Roboflow
  //    until we've actually found TARGET_BINS real bins, the client stops
  //    the scan, or we run out of candidates (bounded by a safety ceiling
  //    so a scan can never run away indefinitely).
  const chipsToScan = candidates.slice(0, MAX_CANDIDATES_SAFETY);
  console.log(
    `[scan] step 4/4: scanning up to ${chipsToScan.length} of ${candidates.length} candidates, stopping at ${TARGET_BINS} found bins`,
  );

  const bins = [];
  let candidatesScanned = 0;

  for (const candidate of chipsToScan) {
    if (req.signal.aborted) {
      console.log("[scan] client aborted — stopping before further chips");
      break;
    }
    if (bins.length >= TARGET_BINS) {
      console.log(
        `[scan] target of ${TARGET_BINS} bins reached — stopping, not sending further chips`,
      );
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

      // We only care about actual grain bins -- sheds and other
      // lookalike structures the model sometimes tags get dropped here
      // before anything else touches this chip's predictions.
      const binPredictions = predictions.filter(
        (p) => !/shed/i.test(p.class ?? p.class_name ?? ""),
      );
      const shedCount = predictions.length - binPredictions.length;
      if (shedCount > 0) {
        console.log(
          `[scan]   [${label}] ignoring ${shedCount} shed detection(s)`,
        );
      }

      // one marker per CHIP, not per prediction -- if Roboflow found
      // multiple bins in the same chip, we still only place one marker
      // at this candidate's location, using the highest-confidence hit.
      if (binPredictions.length > 0) {
        const best = binPredictions.reduce((a, b) =>
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
          detectionCount: binPredictions.length, // how many bins Roboflow actually found in this chip
        });
      }
    } catch (err) {
      // one bad chip/candidate shouldn't kill the whole scan -- log and move on
      console.error(`[scan]   [${label}] FAILED:`, err);
    }
  }

  // If we stopped because we hit the target and there were still
  // unscanned candidates left, there are very likely more bins out there
  // than the ones we're returning -- the UI uses this to say "5+ bins
  // found" and offer the rest as a Pro upgrade instead of implying the
  // scan is complete.
  const moreAvailable =
    bins.length >= TARGET_BINS && candidatesScanned < candidates.length;

  console.log(
    `[scan] complete: ${candidatesScanned} chip(s) sent, ${bins.length} bin(s) returned, moreAvailable=${moreAvailable}`,
  );

  return NextResponse.json({
    area: { lat, lng: lon, boxMiles: box },
    candidatesFound: candidates.length,
    candidatesScanned,
    moreAvailable,
    bins,
  });
}
