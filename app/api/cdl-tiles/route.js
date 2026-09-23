// app/api/cdl-tiles/route.js
import { NextResponse } from 'next/server';
import { initializeEarthEngine } from '@/lib/eeinit';
import ee from '@google/earthengine';

export async function GET(request) {
  try {
    await initializeEarthEngine();

    const { searchParams } = new URL(request.url);
    const lat = parseFloat(searchParams.get('lat'));
    const lng = parseFloat(searchParams.get('lng'));
    const radiusMiles = parseFloat(searchParams.get('radiusMiles'));
    const hasMask = Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radiusMiles);

    const dataset = ee.ImageCollection('USDA/NASS/CDL')
      .filter(ee.Filter.date('2018-01-01', '2018-12-31'))
      .first();

    const cropland = dataset.select('cropland');

    const fromList = [1, 5, 22, 23, 24];
    const toList   = [1, 2, 3, 3, 3];

    let filteredCrop = cropland.remap(fromList, toList, 0).selfMask();

    if (hasMask) {
      // 1 everywhere, 0 inside the scan circle — updateMask() zeroes out
      // (makes transparent) any pixel where this is 0.
      const circleGeom = ee.Geometry.Point([lng, lat])
        .buffer(radiusMiles * 1609.344); // miles -> meters
      const holeMask = ee.Image.constant(1)
        .paint(ee.FeatureCollection([ee.Feature(circleGeom)]), 0);
      filteredCrop = filteredCrop.updateMask(holeMask);
    }

    const visParams = {
      min: 1,
      max: 3,
      palette: ['ffd400', 'ff6600', '543905'],
    };

    const mapId = await new Promise((resolve, reject) => {
      filteredCrop.getMapId(visParams, (result, error) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    return NextResponse.json({ success: true, urlFormat: mapId.urlFormat });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}