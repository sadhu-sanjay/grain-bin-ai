# Grain Storage Finder (plain JavaScript)

Same app as the TypeScript version, converted to plain JavaScript —
no `.ts`/`.tsx` files, no type annotations, no `@types/*` packages,
no `tsconfig.json`. Just a `jsconfig.json` so the `@/` import alias
still works.

- App loads already zoomed into a pre-selected demo area (Cass County, ND)
  and immediately runs (mock) detection on it — no hard-coded pins, the
  same code path just fires automatically on load.
- A search bar lets a visitor type any town/address; it geocodes via
  OpenStreetMap Nominatim, flies the map there, and re-runs detection
  within a fixed 25-mile radius.
- Results drop onto the map one at a time with a live counter, then list
  in the right-hand panel, each with a "Find owner →" link that opens a
  search pointed at that location's county assessor — a stopgap until a
  real ownership-lookup step exists.
- The left panel keeps the original crop-density heatmap (for
  orientation), independent of the bin-detection layer.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Where things live

```
app/
  page.js                    — top-level state + orchestration (read this first)
  layout.js                  — fonts + global CSS
  globals.css                — all styling
  api/detect-bins/route.js   — API route the app calls to run detection

components/
  MapCanvas.jsx               — MapLibre map: county heatmap layer + animated bin markers
  TopBar.jsx                  — brand + search input (geocodes via Nominatim)
  ControlPanel.jsx            — crop layer / density threshold / outlines / basemap controls
  ResultsPanel.jsx            — live bin counter + result list + "Find owner" links
  Legend.jsx                  — bottom-left density legend

lib/
  countyData.js                — mock county crop-density dataset
  mapStyles.js                 — MapLibre basemap style defs (dark via CARTO, satellite via Esri)
  mockDetection.js              — stand-in for the real detection pipeline (see below)
```

## Swapping in the real detection pipeline

Everything funnels through one function: `detectBins()` in
`lib/mockDetection.js`. It currently generates a deterministic scatter of
fake bin coordinates around a center point (same query always returns the
same set, so demos and repeat searches feel consistent). Replace its body
with a call to your actual imagery/CV pipeline, keeping the same input
(`{ lat, lng, radiusMiles, label }`) and output shape
(`[{ id, lat, lng, capacityBushels, confidence }]`) — nothing else in the
app needs to change.

## Known follow-ups

- **Ownership lookup**: not built yet. The "Find owner" link is a
  stopgap search query, not a real API call. When you're ready, this is
  where a parcel-data lookup (Regrid, county GIS, USDA CLU, etc.) would
  plug in.
- **Dark basemap tiles**: CARTO's free raster tiles increasingly require
  an API key; without one they can return a watermarked placeholder tile
  instead of erroring. See the comment in `lib/mapStyles.js` for the fix
  (add a CARTO key, or swap to a keyless source like OSM raster tiles).
- **Search radius**: fixed at 25 miles for now, intentionally not
  exposed as a control yet — a custom radius/area-draw tool was deferred
  to a later version.
