# Grain Bin AI: Grain storage site detection on satellite imagery

<span style="display:inline-block;background:#ec38c4;color:#fff;padding:0.5rem 1rem;border-radius:999px;font-weight:700;font-size:1.5rem;line-height:1;">NEW</span>

Full-stack and computer vision development for a lead-generation tool that finds grain storage bins across the US. Users select a county to start a live scan: building footprints locate farmsteads, DBSCAN clusters them, NAIP aerial imagery is fetched through Google Earth Engine, and a custom RF-DETR model trained on Roboflow detects bins. Results appear as georeferenced boxes on a satellite map. Piloted in Kansas, North Dakota, and Arkansas; scans stop after finding 10 bins.

<div style="margin-top:2rem;display:flex;flex-direction:column;gap:0.8rem;align-items:flex-start;">
  <span style="display:inline-block;border:2px solid #2f3743;border-radius:999px;padding:0.55rem 1.4rem;font-size:2rem;font-weight:600;line-height:1.1;">Computer Vision</span>
  <span style="display:inline-block;border:2px solid #2f3743;border-radius:999px;padding:0.55rem 1.4rem;font-size:2rem;font-weight:600;line-height:1.1;">Google Earth</span>
  <span style="display:inline-block;border:2px solid #2f3743;border-radius:999px;padding:0.55rem 1.4rem;font-size:2rem;font-weight:600;line-height:1.1;">Next.js</span>
  <span style="display:inline-block;border:2px solid #2f3743;border-radius:999px;padding:0.55rem 1.6rem;font-size:2rem;font-weight:600;line-height:1.1;">Geospatial Data</span>
  <span style="display:inline-block;border:2px solid #2f3743;border-radius:999px;padding:0.55rem 1.4rem;font-size:2rem;font-weight:600;line-height:1.1;">Object Detection</span>
</div>
