// app/api/cdl-tiles/route.js
import { NextResponse } from 'next/server';
import { initializeEarthEngine } from '@/lib/eeinit';
import ee from '@google/earthengine';

export async function GET() {
  try {
    await initializeEarthEngine();

    // 1. Load USDA NASS CDL dataset for a single year
    const dataset = ee.ImageCollection('USDA/NASS/CDL')
      .filter(ee.Filter.date('2018-01-01', '2018-12-31'))
      .first();

    const cropland = dataset.select('cropland');

    // 2. Map original crop values to sequential values (1, 2, 3)
    // Original: 1 (Corn), 5 (Soybeans), 22, 23, 24 (Wheats)
    const fromList = [1, 5, 22, 23, 24];
    const toList   = [1, 2, 3, 3, 3]; // Corn -> 1, Soybeans -> 2, All Wheats -> 3

    const filteredCrop = cropland.remap(fromList, toList, 0).selfMask();

    // 3. Set visualization parameters with 3 distinct colors
    const visParams = {
      min: 1,
      max: 3,
      palette: [
        'ffd400', // 1: Corn (Yellow/Gold)
        'ff6600', // 2: Soybeans (Green)
        '543905'  // 3: Wheat (Brown/Tan)
      ]
    };


    // 4. Generate XYZ tile URL template
    const mapId = await new Promise((resolve, reject) => {
      filteredCrop.getMapId(visParams, (result, error) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    return NextResponse.json({ 
      success: true,
      urlFormat: mapId.urlFormat 
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}