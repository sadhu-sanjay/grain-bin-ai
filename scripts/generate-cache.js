// scripts/generate-cache.js
//
// ============================================================================
// TEMPORARY SCRIPT -- remove once the live pipeline serves every search
// instead of just pre-scanned "cached" spots (see app/api/detect-bins/route.js).
// ============================================================================
//
// Runs the REAL detection pipeline (buildings -> cluster -> NAIP chip ->
// Roboflow) for one location, one time, and writes the result to a JSON
// file under data/cached-bins/. app/api/detect-bins/route.js reads that
// file back out instantly instead of re-running the pipeline on every app
// load -- and instead of the fake mockDetection.js data.
//
// This intentionally duplicates the scan loop in
// app/api/scan-location/route.js rather than importing from it, since
// that file is a Next.js route handler (not meant to be called directly)
// and this script is meant to be deleted once it's no longer needed.
//
// USAGE (from the project root, with real env vars in .env.local --
// ROBOFLOW_API_KEY, ROBOFLOW_MODEL_ID, EE_SERVICE_ACCOUNT_KEY):
//
//   npm run generate-cache
//   npm run generate-cache -- --lat=46.8996 --lon=-97.2136 --label="Casselton, ND" --slug=casselton-nd
//
// Re-running it for the same --slug overwrites that file with the latest
// result -- nothing is appended or kept from previous runs.

import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getBuildingsInBbox } from "../lib/microsoftBuildings.js";
import { clusterFarmsteads } from "../lib/clusterFarmsteads.js";
import { getNaipChipUrl } from "../lib/naipChip.js";
import { detectBinsInChip } from "../lib/roboflowDetect.js";
import { estimateCapacityBushels } from "../lib/estimateCapacity.js";

const MILES_TO_KM = 1.60934;
const KM_PER_DEG_LAT = 110.574;
const DEFAULT_BOX_MILES = 6;
const TARGET_BINS = 3; // keep this in sync with app/api/scan-location/route.js
const MAX_CANDIDATES_SAFETY = 40;

// ---- CLI args (all optional -- defaults to the app's default homepage area) ----
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const lat = args.lat ? Number(args.lat) : 46.8996;
const lon = args.lon ? Number(args.lon) : -97.2136;
const label = args.label || "Casselton, ND";
const slug = args.slug || "casselton-nd";
const radiusMiles = args.radiusMiles ? Number(args.radiusMiles) : 25;
const boxMiles = args.boxMiles ? Number(args.boxMiles) : DEFAULT_BOX_MILES;

function bboxAroundPoint(lonC, latC, box) {
  const kmPerDegLon = 111.32 * Math.cos((latC * Math.PI) / 180);
  const halfBoxKm = (box / 2) * MILES_TO_KM;
  const dLat = halfBoxKm / KM_PER_DEG_LAT;
  const dLon = halfBoxKm / kmPerDegLon;
  return [lonC - dLon, latC - dLat, lonC + dLon, latC + dLat];
}

async function main() {
  console.log(`[generate-cache] target: "${label}" at (${lat}, ${lon}), box=${boxMiles}mi`);

  const bbox = bboxAroundPoint(lon, lat, boxMiles);
  console.log(`[generate-cache] bbox = [${bbox.map((n) => n.toFixed(5)).join(", ")}]`);

  console.log("[generate-cache] fetching buildings...");
  const buildings = await getBuildingsInBbox(bbox);
  console.log(`[generate-cache] ${buildings.length} building(s) found`);

  const candidates = clusterFarmsteads(buildings, bbox);
  console.log(`[generate-cache] ${candidates.length} farmstead candidate(s)`);

  const chipsToScan = candidates.slice(0, MAX_CANDIDATES_SAFETY);
  const bins = [];
  let candidatesScanned = 0;

  for (const candidate of chipsToScan) {
    if (bins.length >= TARGET_BINS) {
      console.log(`[generate-cache] target of ${TARGET_BINS} bins reached -- stopping`);
      break;
    }
    candidatesScanned++;
    const tag = `candidate ${candidatesScanned}/${chipsToScan.length}`;

    try {
      const chip = await getNaipChipUrl(candidate.lon, candidate.lat);
      const result = await detectBinsInChip(chip.url);
      const predictions = result?.predictions ?? [];

      const binPredictions = predictions.filter(
        (p) => !/shed/i.test(p.class ?? p.class_name ?? ""),
      );

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
          detectionCount: binPredictions.length,
        });
        console.log(`[generate-cache]   [${tag}] BIN found (${Math.round(best.confidence * 100)}% confidence)`);
      } else {
        console.log(`[generate-cache]   [${tag}] no bin`);
      }
    } catch (err) {
      console.error(`[generate-cache]   [${tag}] FAILED:`, err);
    }
  }

  const output = {
    area: { label, lat, lng: lon, radiusMiles },
    generatedAt: new Date().toISOString(),
    bins,
  };

  const outDir = path.join(process.cwd(), "data", "cached-bins");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${slug}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));

  console.log(`[generate-cache] wrote ${bins.length} bin(s) to ${outPath}`);
}

main().catch((err) => {
  console.error("[generate-cache] FAILED:", err);
  process.exit(1);
});
