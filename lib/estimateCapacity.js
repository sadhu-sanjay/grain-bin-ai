// lib/estimateCapacity.js
//
// The Roboflow model detects WHERE a bin is, not its capacity -- there's
// no capacity signal in the notebook pipeline at all. The UI (ResultsPanel)
// displays a capacityBushels figure though, so this derives a rough estimate
// from the detected bounding box size, converted from pixels -> real-world
// meters using the chip's known geographic extent.
//
// THIS IS A PLACEHOLDER, not a calibrated model. It assumes a fixed
// height-to-diameter ratio for a cylindrical bin, which is a real
// simplification -- actual bin heights vary a lot by type/age/manufacturer.
// Treat the numbers this produces as "rough size class," not something to
// quote to a client without validating against a few known real bins first.

const BUSHELS_PER_CUBIC_METER = 28.38; // 1 bushel = 0.03524 m^3
const ASSUMED_HEIGHT_TO_DIAMETER_RATIO = 0.6; // rough, unvalidated

export function estimateCapacityBushels(prediction, chip) {
  const { chipSizeDeg, dimensionsPx, centerLat } = chip;

  const metersPerDegLat = 110_574;
  const metersPerDegLon = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const chipWidthMeters = chipSizeDeg * metersPerDegLon;
  const chipHeightMeters = chipSizeDeg * metersPerDegLat;

  const metersPerPxX = chipWidthMeters / dimensionsPx;
  const metersPerPxY = chipHeightMeters / dimensionsPx;

  const widthM = prediction.width * metersPerPxX;
  const heightM = prediction.height * metersPerPxY;
  const diameterM = (widthM + heightM) / 2; // average, bins are ~circular

  const radiusM = diameterM / 2;
  const assumedHeightM = diameterM * ASSUMED_HEIGHT_TO_DIAMETER_RATIO;
  const volumeM3 = Math.PI * radiusM * radiusM * assumedHeightM;

  return Math.round((volumeM3 * BUSHELS_PER_CUBIC_METER) / 500) * 500;
}
