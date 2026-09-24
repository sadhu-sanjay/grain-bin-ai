// lib/pixelToGeo.js
//
// The chip is a square-degree region mapped 1:1 onto a square pixel
// image (see naipChip.js), so pixel->degree conversion is linear: one
// pixel is (chipSizeDeg / dimensionsPx) degrees in both directions.
// y=0 is the chip's north edge, increasing toward south.

export function pixelBoxToGeoBox(box, chipBounds, chipSizeDeg, dimensionsPx) {
  const degPerPx = chipSizeDeg / dimensionsPx;
  const west = chipBounds.west + (box.x - box.width / 2) * degPerPx;
  const east = chipBounds.west + (box.x + box.width / 2) * degPerPx;
  const north = chipBounds.north - (box.y - box.height / 2) * degPerPx;
  const south = chipBounds.north - (box.y + box.height / 2) * degPerPx;
  return { west, south, east, north };
}