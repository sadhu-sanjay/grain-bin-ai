// components/SiteInfoPanel.jsx
"use client";

function confidenceTier(c) {
  if (c >= 0.8) return "high";
  if (c >= 0.6) return "medium";
  return "low";
}

export default function SiteInfoPanel({ bin, onClose }) {
  if (!bin) return null;
  const pct = Math.round((bin.confidence ?? 0) * 100);

  return (
    <div className="site-info-panel">
      <div className="popup-title-row">
        <div className="popup-title">Site #{bin.siteNum}</div>
        <button
          type="button"
          className="popup-close-btn"
          aria-label="Close"
          onClick={onClose}
        >
          &times;
        </button>
      </div>
      <div className="popup-row">
        <span>Est. capacity</span>
        <span className="mono">{bin.capacityBushels.toLocaleString()} bu</span>
      </div>
      <div className="popup-row">
        <span>Confidence</span>
        <span className={`confidence-badge ${confidenceTier(bin.confidence ?? 0)}`}>
          {pct}%
        </span>
      </div>
      <div className="popup-row">
        <span>Location</span>
        <span className="mono">{bin.lat.toFixed(4)}°, {bin.lng.toFixed(4)}°</span>
      </div>
      <div className="popup-row">
        <span>Detections</span>
        <span className="mono">{bin.detectionCount} bin(s)</span>
      </div>
      <button
        type="button"
        className="upgrade-owner-btn"
        title="Upgrade to Pro to unlock owner information"
      >
        🔒 Upgrade to Pro for owner info
      </button>
    </div>
  );
}