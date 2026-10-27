# Airport catchment map

The static Beta map reads the saved NZ and Australian snapshots. No routing runs in
the browser. Population density and time-saving colours, popups and totals use
the same statistical areas as before.

Under Map lines, turn off **Show block borders** to hide the grey boundaries.
**Show catchment outline** draws a gold boundary around the combined included
areas, removing shared edges. Holes and disconnected areas remain. The outline
follows the simplified statistical-area polygons, not an exact driving boundary.
It changes with the airport, competitors, threshold, radius and state filters.

The saved snapshots already simplify each block separately. The outline uses
a 150 m display margin to close small seams, then merges the included polygons.
It is approximate; gaps and holes narrower than 300 m may close. Colours,
membership, population totals and CSV data still use the original areas.
The browser uses bundled [polygon-clipping 0.15.7](https://github.com/mfogel/polygon-clipping/tree/v0.15.7)
(MIT; licence in `vendor/LICENSE.polygon-clipping`). Leaflet and OpenStreetMap
background tiles use the existing external URLs.

Checks: `node dev/check_catchment_outline.cjs`, `Rscript dev/check_catchment_site.R`,
`Rscript dev/check_all.R`, and `node dev/check_catchment_browser.cjs` against a
built site served over HTTP (`CATCHMENT_BASE_URL`, default `http://127.0.0.1:5567`).
