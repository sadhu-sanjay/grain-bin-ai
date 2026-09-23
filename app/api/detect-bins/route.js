import { NextResponse } from "next/server";
import { detectBins } from "@/lib/mockDetection";

export async function POST(req) {
  const body = await req.json();
  const { lat, lng, label, radiusMiles } = body ?? {};

  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json(
      { error: "lat and lng (numbers) are required" },
      { status: 400 }
    );
  }

  const area = {
    label: typeof label === "string" && label.trim() ? label : "Selected area",
    lat,
    lng,
    radiusMiles: typeof radiusMiles === "number" ? radiusMiles : 25,
  };

  const bins = await detectBins(area);
  return NextResponse.json({ area, bins });
}
