"use client";

import { getConfidenceTier } from "@/lib/confidence";

const DISPLAY_LIMIT = 5; // free tier only ever shows the top 5 — rest is the Pro upsell

function assessorSearchUrl(bin) {
  // Stopgap until an ownership-lookup API exists: point the user at a
  // general parcel-search query they can run themselves for that county.
  return `https://www.google.com/search?q=county+assessor+parcel+search+near+${bin.lat.toFixed(
    4
  )},${bin.lng.toFixed(4)}`;
}

function handleUpgradeClick(e) {
  e.stopPropagation();
  // No billing backend yet — this is the placeholder CTA for the paywall.
  alert("Pro is coming soon. Upgrade to unlock the full result list and owner information.");
}

export default function ResultsPanel({
  area,
  revealedBins,
  totalBins,
  moreAvailable,
  loading,
  selectedBinId,
  onResultClick,
}) {
  const displayBins = revealedBins.slice(0, DISPLAY_LIMIT);
  const capped = moreAvailable || totalBins > DISPLAY_LIMIT;

  let titleText;
  if (loading) {
    titleText = "Scanning for storage sites…";
  } else if (capped) {
    titleText = `${DISPLAY_LIMIT}+ bins found`;
  } else {
    titleText = `${totalBins} bin${totalBins === 1 ? "" : "s"} found`;
  }

  return (
    <div className="results">
      <div className="results-header">
        <div className="title">
          {loading && <span className="spinner" />}
          <span className="title-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path
                d="M12 2 L19 7 V19 A7 4 0 0 1 5 19 V7 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M5 7 A7 4 0 0 0 19 7" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </span>
          {titleText}
        </div>
        <div className="sub">
          {area
            ? `Within ${area.radiusMiles} mi of ${area.label}`
            : "Sorted by estimated capacity"}
        </div>
      </div>
      <div className="results-list">
        {displayBins.map((bin, i) => {
          const tier = getConfidenceTier(bin.confidence);
          const selected = bin.id === selectedBinId;
          return (
            <div
              className={`result-item${selected ? " selected" : ""}`}
              key={bin.id}
              onClick={() => onResultClick(bin)}
            >
              <div className="r-top">
                <span className="r-name">
                  <span className="r-bin-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="13" height="13">
                      <path
                        d="M12 2 L19 7 V19 A7 4 0 0 1 5 19 V7 Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M5 7 A7 4 0 0 0 19 7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                    </svg>
                  </span>
                  Site #{i + 1}
                </span>
                <span
                  className={`confidence-badge conf-${tier.key}`}
                  style={{ "--conf-color": tier.color }}
                >
                  {Math.round(bin.confidence * 100)}%
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
                <span aria-hidden="true">🔒</span> Upgrade to Pro for owner info
              </a>
            </div>
          );
        })}
      </div>

      {!loading && capped && (
        <div className="upsell-banner">
          <div className="upsell-text">
            <span className="upsell-title">Full list locked</span>
            <span className="upsell-sub">
              See every detected site &amp; owner info with Pro
            </span>
          </div>
          <button
            type="button"
            className="upsell-btn"
            onClick={handleUpgradeClick}
          >
            Upgrade to Pro
          </button>
        </div>
      )}
    </div>
  );
}
