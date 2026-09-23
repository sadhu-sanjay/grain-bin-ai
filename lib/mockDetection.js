// ---------------------------------------------------------------------
// This module stands in for the real detection pipeline (satellite/aerial
// imagery -> CV model -> bin coordinates). It is deterministic per query
// (same center + radius always returns the same set of bins) so a demo
// or a repeated search feels like a real lookup rather than random noise.
//
// TO REPLACE WITH THE REAL PIPELINE: swap the body of `detectBins` below
// for a call to your actual detection service/model, keeping the same
// input ({ lat, lng, radiusMiles, label }) and output (array of bins)
// shape so nothing else in the app has to change.
// ---------------------------------------------------------------------

function seededRandom(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const MILES_PER_DEGREE_LAT = 69.0;

export async function detectBins(area) {
  const seed = `${area.lat.toFixed(3)},${area.lng.toFixed(3)},${area.radiusMiles}`;
  const rand = seededRandom(seed);

  // Simulate the pipeline doing real work.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const count = 18 + Math.floor(rand() * 25); // 18-42 bins
  const milesPerDegreeLng =
    MILES_PER_DEGREE_LAT * Math.cos((area.lat * Math.PI) / 180);

  const bins = [];
  for (let i = 0; i < count; i++) {
    // Uniform-in-disc sampling around the center point.
    const angle = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * area.radiusMiles;
    const dLat = (dist * Math.sin(angle)) / MILES_PER_DEGREE_LAT;
    const dLng = (dist * Math.cos(angle)) / milesPerDegreeLng;

    bins.push({
      id: `${seed}-${i}`,
      lat: area.lat + dLat,
      lng: area.lng + dLng,
      capacityBushels: Math.round((15000 + rand() * 180000) / 500) * 500,
      confidence: Math.round((0.62 + rand() * 0.36) * 100) / 100,
    });
  }

  // Largest / most confident detections first — these are the better leads.
  bins.sort((a, b) => b.capacityBushels - a.capacityBushels);
  return bins;
}
