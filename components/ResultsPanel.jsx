"use client";

function assessorSearchUrl(bin) {
  // Stopgap until an ownership-lookup API exists: point the user at a
  // general parcel-search query they can run themselves for that county.
  return `https://www.google.com/search?q=county+assessor+parcel+search+near+${bin.lat.toFixed(
    4
  )},${bin.lng.toFixed(4)}`;
}

export default function ResultsPanel({
  area,
  revealedBins,
  totalBins,
  loading,
  onResultClick,
}) {
  return (
    <div className="results">
      <div className="results-header">
        <div className="title">
          {loading && <span className="spinner" />}
          {loading ? "Scanning for storage sites…" : `${totalBins} bins found`}
        </div>
        <div className="sub">
          {area
            ? `Within ${area.radiusMiles} mi of ${area.label}`
            : "Sorted by estimated capacity"}
        </div>
      </div>
      <div className="results-list">
        {revealedBins.map((bin, i) => (
          <div
            className="result-item"
            key={bin.id}
            onClick={() => onResultClick(bin)}
          >
            <div className="r-top">
              <span className="r-name">Site #{i + 1}</span>
              <span className="r-state mono">
                {Math.round(bin.confidence * 100)}% confidence
              </span>
            </div>
            <div className="r-meta">
              <span className="mono">
                ~{bin.capacityBushels.toLocaleString()} bu
              </span>
              <span className="mono">
                {bin.lat.toFixed(3)}, {bin.lng.toFixed(3)}
              </span>
            </div>
            <a
              className="find-owner-btn"
              href={assessorSearchUrl(bin)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              Find owner →
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
