import { NextResponse } from "next/server";
import { getBuildingsInBbox } from "@/lib/microsoftBuildings";
import { clusterFarmsteads } from "@/lib/clusterFarmsteads";
import { getNaipChipUrl } from "@/lib/naipChip";
import { detectBinsInChip } from "@/lib/roboflowDetect";
import { estimateCapacityBushels } from "@/lib/estimateCapacity";
import { pixelBoxToGeoBox } from "@/lib/pixelToGeo";

const MILES_TO_KM = 1.60934;
const KM_PER_DEG_LAT = 110.574; // ~constant everywhere

const DEFAULT_BOX_MILES = 6;
const TARGET_BINS = 5; // keep scanning candidates until we have at least this many
const MAX_CANDIDATES_TO_SCAN = 25; // hard safety ceiling on Roboflow calls per scan
const CANDIDATE_CONCURRENCY = 5; // how many candidates to chip+detect at once

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
  const box = typeof boxMiles === "number" ? boxMiles : DEFAULT_BOX_MILES;
  const bbox = bboxAroundPoint(lon, lat, box);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        emit({ type: "progress", stage: "buildings", status: "start" });
        const t0 = Date.now();
        const buildings = await getBuildingsInBbox(bbox, req.signal);
        emit({
          type: "progress",
          stage: "buildings",
          status: "done",
          count: buildings.length,
          ms: Date.now() - t0,
        });

        const t1 = Date.now();
        const candidates = clusterFarmsteads(buildings, bbox);
        emit({
          type: "progress",
          stage: "clustering",
          status: "done",
          count: candidates.length,
          ms: Date.now() - t1,
        });

        let candidatesScanned = 0;
        const bins = [];

        async function processCandidate(candidate, index) {
          emit({
            type: "progress",
            stage: "candidate",
            index,
            of: candidates.length,
            status: "chip-start",
          });
          const tChip = Date.now();
          const chip = await getNaipChipUrl(candidate.lon, candidate.lat);
          emit({
            type: "progress",
            stage: "candidate",
            index,
            status: "chip-done",
            ms: Date.now() - tChip,
          });

          emit({
            type: "progress",
            stage: "candidate",
            index,
            status: "roboflow-start",
          });
          const tRf = Date.now();
          const result = await detectBinsInChip(chip.url, req.signal);
          const predictions = (result?.predictions ?? []).filter(
            (p) => (p.class ?? "").toLowerCase() !== "shed",
          );
          emit({
            type: "progress",
            stage: "candidate",
            index,
            status: "roboflow-done",
            ms: Date.now() - tRf,
            found: predictions.length > 0,
          });

          if (predictions.length === 0) return null;

          const best = predictions.reduce((a, b) =>
            (b.confidence ?? 0) > (a.confidence ?? 0) ? b : a,
          );
          const geoBoxFor = (p) =>
            pixelBoxToGeoBox(
              p,
              chip.bounds,
              chip.chipSizeDeg,
              chip.dimensionsPx,
            );
          return {
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
            detections: [best, ...predictions.filter((p) => p !== best)].map(
              (p, idx) => ({
                bounds: geoBoxFor(p),
                confidence: p.confidence ?? null,
                primary: idx === 0,
              }),
            ),
          };
        }

        for (
          let start = 0;
          start < candidates.length;
          start += CANDIDATE_CONCURRENCY
        ) {
          if (bins.length >= TARGET_BINS) break;
          if (candidatesScanned >= MAX_CANDIDATES_TO_SCAN) break;
          if (req.signal.aborted) break;

          const remaining = MAX_CANDIDATES_TO_SCAN - candidatesScanned;
          const batch = candidates.slice(
            start,
            start + Math.min(CANDIDATE_CONCURRENCY, remaining),
          );
          if (batch.length === 0) break;

          candidatesScanned += batch.length;

          const settled = await Promise.allSettled(
            batch.map((candidate, i) =>
              processCandidate(candidate, start + i + 1),
            ),
          );

          for (const outcome of settled) {
            if (outcome.status === "fulfilled" && outcome.value) {
              bins.push(outcome.value);
              emit({ type: "bin", bin: outcome.value }); // ← the actual "show it now" event
            } else if (outcome.status === "rejected") {
              emit({
                type: "progress",
                stage: "candidate",
                status: "error",
                message: String(outcome.reason),
              });
            }
          }
        }

        emit({
          type: "done",
          candidatesScanned,
          hitTarget: bins.length >= TARGET_BINS,
        });
      } catch (err) {
        emit({ type: "error", message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
