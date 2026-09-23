// lib/microsoftBuildings.js
//
// Fetches buildings inside a bbox from Microsoft's Building Footprints
// dataset (the notebook's original source), replacing the Overture/DuckDB
// approach -- Overture's buildings files aren't geographically pre-split,
// so DuckDB had to probe metadata across a huge number of remote files
// before it could filter, which made small-area queries very slow.
//
// Microsoft's files ARE pre-split, at zoom-9 quadkey tiles (~15km each),
// indexed by dataset-links.csv. So the tradeoff flips: fetching is fast
// (one HTTP GET for the right tile, no metadata scanning), but each tile
// contains ALL buildings in that ~15km area, so we filter to our small
// bbox ourselves after downloading, and cache the parsed tile so a second
// nearby click doesn't re-download/re-parse it.

import zlib from "zlib";

const LINKS_URL =
  "https://bfppub.blob.core.windows.net/$web/2026-07-24/dataset-links.csv";
const COARSE_ZOOM = 9; // matches dataset-links.csv's partitioning

// --- dataset-links.csv index: quadkey -> file url, fetched once ---
let linksPromise = null;

async function getLinksIndex() {
  if (!linksPromise) {
    linksPromise = (async () => {
      console.log("[microsoft] fetching dataset-links.csv index...");
      const res = await fetch(LINKS_URL);
      const text = await res.text();
      const lines = text.trim().split("\n");
      const index = new Map(); // quadkey -> url

      // Real header is "Location,QuadKey,Url" -- THREE columns. Taking
      // everything before the first comma (the old bug) grabs "Location"
      // (e.g. "UnitedStates"), not the quadkey -- every real lookup then
      // missed and the whole CSV collapsed into ~225 country-keyed rows.
      const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const quadkeyCol = header.indexOf("quadkey");
      const urlCol = header.indexOf("url");
      if (quadkeyCol === -1 || urlCol === -1) {
        throw new Error(
          `[microsoft] unexpected dataset-links.csv header: ${lines[0]}`,
        );
      }

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        let quadkey = cols[quadkeyCol]?.trim();
        const url = cols[urlCol]?.trim();
        if (!quadkey || !url) continue;

        if (/^\d+$/.test(quadkey) && quadkey.length < COARSE_ZOOM) {
          quadkey = quadkey.padStart(COARSE_ZOOM, "0");
        }
        index.set(quadkey, url);
      }
      console.log(`[microsoft] index loaded: ${index.size} tiles`);
      console.log(
        `[microsoft] sample keys: ${[...index.keys()].slice(0, 5).join(", ")}`,
      );
      return index;
    })();
  }
  return linksPromise;
}
// --- lon/lat -> zoom-9 quadkey (standard slippy-map tile math) ---

function lonLatToTileXY(lon, lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

function tileXYToQuadkey(x, y, zoom) {
  let quadkey = "";
  for (let i = zoom; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) digit += 1;
    if ((y & mask) !== 0) digit += 2;
    quadkey += digit;
  }
  return quadkey;
}

function quadkeysOverlappingBbox(bbox) {
  const [west, south, east, north] = bbox;
  const corners = [
    [west, south],
    [west, north],
    [east, south],
    [east, north],
  ];
  const quadkeys = new Set();
  for (const [lon, lat] of corners) {
    const { x, y } = lonLatToTileXY(lon, lat, COARSE_ZOOM);
    quadkeys.add(tileXYToQuadkey(x, y, COARSE_ZOOM));
  }
  return [...quadkeys];
}

// --- polygon centroid (shoelace formula, exterior ring only) ---

function polygonCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (area === 0) {
    const sum = ring.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
    return [sum[0] / ring.length, sum[1] / ring.length];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

function ringBbox(ring) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function bboxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

// --- per-tile download + parse, cached by quadkey (tiles don't change
//     within a session, so no TTL needed -- once fetched, reused forever) ---

const tileCache = new Map(); // quadkey -> [{ id, lon, lat, bbox }]

async function getTileBuildings(quadkey, url, signal) {
  if (tileCache.has(quadkey)) {
    console.log(`[microsoft] tile cache hit: ${quadkey}`);
    return tileCache.get(quadkey);
  }

  console.log(`[microsoft] downloading tile ${quadkey}...`);
  const dlStart = Date.now();
  const res = await fetch(url, { signal });
  const compressed = Buffer.from(await res.arrayBuffer());
  const raw = zlib.gunzipSync(compressed);
  const lines = raw.toString("utf-8").trim().split("\n");
  console.log(
    `[microsoft] tile ${quadkey}: ${lines.length} buildings (${Date.now() - dlStart}ms)`,
  );

  const buildings = [];
  for (const line of lines) {
    if (!line) continue;
    let feat;
    try {
      feat = JSON.parse(line);
    } catch {
      continue;
    }

    const geom = feat.geometry;
    if (!geom || geom.type !== "Polygon") continue; // skip MultiPolygon/etc -- rare for buildings

    const ring = geom.coordinates[0];
    const [lon, lat] = polygonCentroid(ring);
    buildings.push({
      id: feat.id ?? `${quadkey}-${buildings.length}`,
      lon,
      lat,
      bbox: ringBbox(ring),
    });
  }

  tileCache.set(quadkey, buildings);
  return buildings;
}

/**
 * Fetch buildings inside a bbox = [west, south, east, north].
 * Returns [{ id, lon, lat }, ...] -- same shape the Overture version returned.
 */
export async function getBuildingsInBbox(bbox, signal) {
  const index = await getLinksIndex();
  const quadkeys = quadkeysOverlappingBbox(bbox);
  console.log(
    `[microsoft] bbox overlaps ${quadkeys.length} tile(s): ${quadkeys.join(", ")}`,
  );

  const results = [];
  for (const quadkey of quadkeys) {
    const url = index.get(quadkey);
    if (!url) {
      console.log(
        `[microsoft] no tile found in index for quadkey ${quadkey} (probably outside coverage)`,
      );
      continue;
    }

    const tileBuildings = await getTileBuildings(quadkey, url, signal);

    for (const b of tileBuildings) {
      if (bboxesOverlap(b.bbox, bbox)) {
        results.push({ id: b.id, lon: b.lon, lat: b.lat });
      }
    }
  }

  console.log(
    `[microsoft] ${results.length} building(s) inside requested bbox`,
  );
  return results;
}
