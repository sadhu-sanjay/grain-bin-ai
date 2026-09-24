// lib/naipChip.js
//
// Ports the notebook's Cell 5: pull a small true-color NAIP thumbnail
// centered on a candidate point, sized to whatever your Roboflow model
// was trained on.
//
// IMPORTANT: CHIP_SIZE_DEG must match your model's training chip size.
// The original notebook used 0.0035 (~389m at typical US latitudes) to
// generate training chips -- if you feed the model chips 10x larger,
// every bin shrinks to ~1/10th the pixel size it learned on, and
// detection will likely fail or miss almost everything. Override via
// the NAIP_CHIP_SIZE_DEG env var if your model used a different size.

import ee from "@google/earthengine";
import { initializeEarthEngine } from "./eeinit";

const CHIP_SIZE_DEG = Number(process.env.NAIP_CHIP_SIZE_DEG || 0.0035);
const CHIP_DIMENSIONS_PX = 640;

/**
 * Get a NAIP true-color PNG thumbnail URL centered on (lon, lat).
 */
export async function getNaipChipUrl(lon, lat) {
  await initializeEarthEngine();

  const bounds = {
    west: lon - CHIP_SIZE_DEG / 2,
    south: lat - CHIP_SIZE_DEG / 2,
    east: lon + CHIP_SIZE_DEG / 2,
    north: lat + CHIP_SIZE_DEG / 2,
  };
  const region = ee.Geometry.Rectangle([
    bounds.west,
    bounds.south,
    bounds.east,
    bounds.north,
  ]);

  // NAIP has 4 bands (R, G, B, N/near-infrared). PNG only supports 1 or 3
  // bands, so drop NIR and keep true-color RGB -- also what the Roboflow
  // model expects visually, matching its training data.
  const naipImg = ee
    .ImageCollection("USDA/NAIP/DOQQ")
    .filterDate("2021-01-01", "2023-12-31")
    .filterBounds(region)
    .mosaic()
    .clip(region)
    .select(["R", "G", "B"]);

  const url = await new Promise((resolve, reject) => {
    naipImg.getThumbURL(
      { region, dimensions: CHIP_DIMENSIONS_PX, format: "png" },
      (result, error) => {
        if (error) reject(new Error(error));
        else resolve(result);
      },
    );
  });

  return {
    url,
    chipSizeDeg: CHIP_SIZE_DEG,
    dimensionsPx: CHIP_DIMENSIONS_PX,
    bounds, // <-- new
  };
}
