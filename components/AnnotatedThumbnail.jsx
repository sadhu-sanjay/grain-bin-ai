"use client";

// Converts one detection's geo bounding box (already in lat/lon -- the same
// `detections[].bounds` MapCanvas uses to draw on the live map) into a
// percentage-of-image box, using the chip's own geo bounds as the frame of
// reference. Works because naipChip.js maps a square-degree region 1:1 onto
// a square image (see lib/pixelToGeo.js), so this is a plain linear rescale.
function geoBoxToPercent(box, chipBounds) {
  const lonSpan = chipBounds.east - chipBounds.west;
  const latSpan = chipBounds.north - chipBounds.south;

  const left = ((box.west - chipBounds.west) / lonSpan) * 100;
  const right = ((box.east - chipBounds.west) / lonSpan) * 100;
  const top = ((chipBounds.north - box.north) / latSpan) * 100;
  const bottom = ((chipBounds.north - box.south) / latSpan) * 100;

  return { left, top, width: right - left, height: bottom - top };
}

export default function AnnotatedThumbnail({ bin, className = "" }) {
  if (!bin.chipImage || !bin.chipBounds) return null;

  return (
    <div className={`thumb-wrap ${className}`.trim()}>
      <img src={bin.chipImage} alt="" className="thumb-img" />
      <svg
        className="thumb-overlay"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {bin.detections?.map((d, i) => {
          const box = geoBoxToPercent(d.bounds, bin.chipBounds);
          return (
            <rect
              key={i}
              x={box.left}
              y={box.top}
              width={box.width}
              height={box.height}
              className={d.primary ? "det-box det-primary" : "det-box det-secondary"}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
    </div>
  );
}