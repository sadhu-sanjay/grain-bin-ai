// Matches the palette used for the live USDA NASS CDL tiles from Earth
// Engine (see app/api/cdl-tiles/route.js) — keep these in sync.
const CROPS = [
  { label: "Corn", color: "#ffd400" },
  { label: "Soybeans", color: "#ff6600" },
  { label: "Wheat", color: "#543905" },
];

export default function CropLegend() {
  return (
    <div className="crop-legend">
      <span className="crop-legend-title">United States Cropland</span>
      <div className="crop-legend-items">
        {CROPS.map((c) => (
          <div className="crop-legend-item" key={c.label}>
            <span
              className="crop-legend-swatch"
              style={{ background: c.color }}
            />
            <span>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}