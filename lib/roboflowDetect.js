// lib/roboflowDetect.js
//
// Ports the notebook's Cell 7: send one chip's image URL to Roboflow's
// Serverless Hosted API and get back raw detections.
//
// Requires env vars:
//   ROBOFLOW_API_KEY
//   ROBOFLOW_MODEL_ID   e.g. "sanjay-goswami/grain-bin-detection-waqqm-2-rfdetr-small-t1"
//
// Do NOT hardcode these -- the notebook version had the key inline as a
// string, which is fine for a private Colab cell but must not ship in
// any file that reaches source control or the deployed bundle. Put both
// in your .env.local (and Firebase App Hosting's secret/env config for
// production), and rotate the key that was in the notebook since it's
// already been shared in plaintext.

const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
const ROBOFLOW_MODEL_ID = process.env.ROBOFLOW_MODEL_ID;

/**
 * Run inference on a single chip (by URL) via Roboflow.
 * Returns Roboflow's raw response: { predictions: [...], image: {...} }
 */
export async function detectBinsInChip(imageUrl, signal) {
  if (!ROBOFLOW_API_KEY || !ROBOFLOW_MODEL_ID) {
    throw new Error(
      "ROBOFLOW_API_KEY / ROBOFLOW_MODEL_ID env vars are not set.",
    );
  }

  const params = new URLSearchParams({
    api_key: ROBOFLOW_API_KEY,
    image: imageUrl,
  });

  const res = await fetch(
    `https://detect.roboflow.com/${ROBOFLOW_MODEL_ID}?${params}`,
    {
      method: "POST",
      signal,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Roboflow request failed: ${res.status} ${text}`);
  }

  return res.json();
}
