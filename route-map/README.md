# Aviation route map

This is a local browser tool, built into the Altitude static site. Open
`publish/route-map/` after building the site. Uploaded files are read in memory;
they are not sent to a server or saved in browser storage. All dependencies are
bundled. Serve the page over HTTP; browsers restrict local file fetches.

## Input

Use CSV or `.xlsx` (first worksheet), up to 5 MB and 2,000 non-empty route rows.
Use a header row; headings ignore case and spaces/hyphens become underscores.

| Column | Meaning |
| --- | --- |
| origin, destination | Required 3–4 character airport codes |
| flights, seats | Optional non-negative numbers; use a consistent period |
| airline | Optional name for filtering |
| origin_lat, origin_lon | Optional decimal-degree coordinates |
| destination_lat, destination_lon | Optional decimal-degree coordinates |

The page lists built-in airports. Supply coordinates for other airports; both
latitude and longitude are required. One supplied coordinate pair applies to
that airport throughout the file. Conflicting coordinates are rejected.
Longitude must be −180 to 180 and latitude −90 to 90. Blank metrics are missing,
not zero. Invalid files retain the previous map and display an error.

Rows for the same pair (including reverse directions) are summed after airline
filtering. Only select seats/flights if every included pair has that metric and
at least one total is positive. Zero totals are hidden for that metric. Widths
scale against the largest pair with a 15% minimum for visibility. Equal widths
are available for route lists without figures. No live airline schedule is
implied. `sample.csv` and `sample.xlsx` use invented annual figures.

## Map and export

Paths follow great circles, not actual flight tracks. The regional projection
adjusts longitude scale for the view's central latitude. Automatic bounds fit
the complete paths, including crossings of the date line. World and Australia/
New Zealand presets and custom bounds are available. Custom east may exceed
180 for a date-line crossing. Custom bounds clip geography, paths and airports.
Exactly coincident or antipodal endpoints are rejected because their route
direction is undefined. Labels try several positions to avoid overlap; dense
networks may need airport-code labels or labels turned off.

Set the title, source and period before exporting. SVG keeps geography, paths,
labels and text as vectors, with an SVG blur filter for the glow. PNG is
3600 × 2250 pixels. Both include source, metric units and attribution, and use
the same SVG as the preview. `map.js` exposes reusable parsing, validation,
aggregation and geometry functions as `RouteMap` in a browser or CommonJS in Node.

## Bundled sources

- [Natural Earth land, 1:110m](https://www.naturalearthdata.com/downloads/110m-physical-vectors/),
  public domain. `land.geojson` comes from the
  [v5.1.2 source](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_land.geojson),
  with unused properties removed; geometry is unchanged.
- [SheetJS CE 0.20.3](https://docs.sheetjs.com/docs/getting-started/installation/standalone/),
  official standalone mini build for XLSX. Apache 2.0 licence in
  `vendor/LICENSE.sheetjs`. No CDN calls at runtime.
- Queenstown example coordinates: user-supplied brief. Other built-in airports
  use approximate reference locations; override for precise reporting.

Run `node dev/check_route_map.cjs`, `Rscript dev/check_all.R` and
`Rscript dev/check_publish_all.R`. Check the page and downloads in a browser at
desktop and 375px widths. Do not run data updates.
