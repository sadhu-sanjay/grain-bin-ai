// Single always-on basemap: Esri World Imagery satellite tiles.
// `glyphs` is required for the county-name symbol layer in MapCanvas —
// without it MapLibre silently drops all text labels.
export const SAT_STYLE = {
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    "esri-sat": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Esri World Imagery",
    },
  },
  layers: [{ id: "bg", type: "raster", source: "esri-sat" }],
};
