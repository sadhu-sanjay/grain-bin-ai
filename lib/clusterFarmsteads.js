// lib/clusterFarmsteads.js
//
// Ports the notebook's Cell 4: DBSCAN over building centroids, projected
// into local flat meters (not degrees, since 100m needs to mean the same
// thing everywhere). Unlike the original notebook, this does NOT use a
// fixed UTM zone (EPSG:32614 only worked for Kansas) -- it builds a local
// projection centered on the query box itself, which stays accurate to
// well under a meter across a 6-mile box and works correctly anywhere
// in the US without tracking UTM zones.

import { DBSCAN } from "density-clustering";

const M_PER_DEG_LAT = 110_574; // ~constant everywhere

function metersPerDegLon(lat) {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

/**
 * @param {{id, lon, lat}[]} buildings
 * @param {[west, south, east, north]} bbox
 * @param {object} [opts]
 * @param {number} [opts.eps=100]      meters -- buildings this close count as one site
 * @param {number} [opts.minPts=3]     min buildings to form a cluster at all
 * @param {number} [opts.minSize=3]    min cluster size to keep ("farmstead", not a lone house)
 * @param {number} [opts.maxSize=15]   max cluster size to keep (bigger = probably a town)
 * @returns {{lon, lat, buildingCount}[]} one candidate point per surviving cluster
 */
export function clusterFarmsteads(
  buildings,
  bbox,
  { eps = 100, minPts = 3, minSize = 3, maxSize = 15 } = {}
) {
  if (buildings.length === 0) return [];

  const [west, south, east, north] = bbox;
  const centerLat = (south + north) / 2;
  const centerLon = (west + east) / 2;
  const mPerDegLon = metersPerDegLon(centerLat);

  // project every building into meters, relative to the box center
  const points = buildings.map((b) => [
    (b.lon - centerLon) * mPerDegLon,
    (b.lat - centerLat) * M_PER_DEG_LAT,
  ]);

  const dbscan = new DBSCAN();
  const clusters = dbscan.run(points, eps, minPts);
  // dbscan.noise (isolated buildings, not part of any cluster) is
  // implicitly dropped, same as the notebook's `cluster != -1` filter --
  // we just never look at it.

  const farmsteads = [];
  for (const clusterIndices of clusters) {
    if (clusterIndices.length < minSize || clusterIndices.length > maxSize) {
      continue; // too small (lone building) or too big (probably a town)
    }

    const members = clusterIndices.map((i) => buildings[i]);
    const lon = members.reduce((sum, m) => sum + m.lon, 0) / members.length;
    const lat = members.reduce((sum, m) => sum + m.lat, 0) / members.length;

    farmsteads.push({ lon, lat, buildingCount: members.length });
  }

  return farmsteads;
}
