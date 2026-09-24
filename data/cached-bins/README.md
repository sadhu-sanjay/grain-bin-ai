# Cached detection results

Empty until you run:

    npm run generate-cache

That writes one JSON file per location here (e.g. `casselton-nd.json`),
using the REAL pipeline (`lib/microsoftBuildings.js` -> `lib/clusterFarmsteads.js`
-> `lib/naipChip.js` -> `lib/roboflowDetect.js`), not the mock data.

`app/api/detect-bins/route.js` checks this folder first and serves a
matching file instantly if one exists, falling back to `lib/mockDetection.js`
for any location that hasn't been cached.

Re-running `npm run generate-cache` for the same `--slug` overwrites that
file with the latest result -- nothing is appended or versioned, it's
always just the most recent run.

This whole cache-lookup approach (this folder, `scripts/generate-cache.js`,
and the cache check in `app/api/detect-bins/route.js`) is a temporary stand-in
until the live pipeline is fast/cheap enough to run on every search directly.
