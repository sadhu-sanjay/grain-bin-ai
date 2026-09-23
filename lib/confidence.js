// lib/confidence.js
//
// One shared definition of "how good is this detection" so the results
// list, the map markers, and the selected-bin annotation all agree on
// what counts as high/medium/low confidence and use the same colors.

export const CONFIDENCE_TIERS = {
  high: { min: 0.85, label: "High", color: "#6fbf73" },
  medium: { min: 0.65, label: "Medium", color: "#e4c55e" },
  low: { min: 0, label: "Low", color: "#e0776a" },
};

export function getConfidenceTier(confidence) {
  const c = confidence ?? 0;
  if (c >= CONFIDENCE_TIERS.high.min) return { key: "high", ...CONFIDENCE_TIERS.high };
  if (c >= CONFIDENCE_TIERS.medium.min) return { key: "medium", ...CONFIDENCE_TIERS.medium };
  return { key: "low", ...CONFIDENCE_TIERS.low };
}
