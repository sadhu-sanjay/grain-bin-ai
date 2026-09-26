"use client";

function confidenceTier(c) {
  if (c >= 0.8) return "high";
  if (c >= 0.6) return "medium";
  return "low";
}

function ConfidenceBadge({ confidence }) {
  const pct = Math.round((confidence ?? 0) * 100);
  return (
    <span className={`confidence-badge ${confidenceTier(confidence ?? 0)}`}>
      {pct}%
    </span>
  );
}

export default function ResultsPanel({
  area,
  revealedBins,
  totalBins,
  hitTarget,
  loading,
  onResultClick,
  onStop,
}) {
  return (
    <div className="results">
      <div className="results-header">
        <div className="title">
          {loading && <span className="spinner" />}
          <span className="title-text">
            {loading
              ? "Scanning for storage sites…"
              : hitTarget
                ? `At least ${totalBins} bins found`
                : `${totalBins} bins found`}
          </span>
          {loading && (
            <button
              type="button"
              className="stop-scan-btn"
              onClick={onStop}
            >
              Stop
            </button>
          )}
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
              <ConfidenceBadge confidence={bin.confidence} />
            </div>
            <div className="r-meta">
              <span className="mono">
                ~{bin.capacityBushels.toLocaleString()} bu
              </span>
              <span className="mono">
                {bin.lat.toFixed(3)}, {bin.lng.toFixed(3)}
              </span>
            </div>
            <button
              type="button"
              className="upgrade-owner-btn"
              title="Upgrade to Pro to unlock owner information"
              onClick={(e) => e.stopPropagation()}
            >
              🔒 Upgrade to Pro for owner info
            </button>
          </div>
        ))}
      </div>
      {!loading && hitTarget && (
        <div className="upgrade-banner">
          <div className="ub-title">More sites likely nearby</div>
          <div className="ub-sub">
            This preview stops at {totalBins} results per scan.
          </div>
          <button type="button">Upgrade to Pro for the full list</button>
        </div>
      )}
    </div>
  );
}
