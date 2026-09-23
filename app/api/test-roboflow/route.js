import { NextResponse } from "next/server";
import { getNaipChipUrl } from "@/lib/naipChip";
import { detectBinsInChip } from "@/lib/roboflowDetect";

// GET /api/test-roboflow?lat=41.7&lon=-95.3
// Isolated proof-of-life for the Roboflow half of the pipeline only --
// pulls one real NAIP chip via Earth Engine and sends it straight to
// Roboflow, with no Overture/DuckDB building lookup involved at all.
// Useful for confirming ROBOFLOW_API_KEY / ROBOFLOW_MODEL_ID actually
// work before debugging anything else in the pipeline.
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat") ?? 41.7);
  const lon = Number(searchParams.get("lon") ?? -95.3);

  try {
    const chip = await getNaipChipUrl(lon, lat);
    const result = await detectBinsInChip(chip.url);

    return NextResponse.json({
      point: { lat, lon },
      chipUrl: chip.url, // open this directly in a browser to see the actual image sent
      roboflowResponse: result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
