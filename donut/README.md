# Where Auckland builds (3D map, Beta)

A static page for the Auckland donut study (E11). Each Auckland SA2 has two
bars: people (2023 Census, or 2013 in the growth view) and new homes consented
since a year the reader picks, or population growth from the 2013 to 2023
Census. Bars can show totals or amounts per hectare of land.

- `data/donut.json` is written by `run_donut_analysis()` (`analysis/donut/donut_analysis.R`).
  Do not edit it by hand.
- `donut.js` is the pure logic (totals, half-distances, scales). It also loads
  in Node for `dev/check_donut_map.cjs`.
- `ui.js` draws the map with deck.gl (`vendor/`, MIT licence) and wires the controls.
- Basemap: standard OpenStreetMap tiles (as the catchments page uses), shown muted,
  © OpenStreetMap contributors. OpenStreetMap needs the browser to send a referrer, so
  the page must not set `no-referrer`.
  The map still draws its bars and distance rings if the tiles fail.
- Colours and fonts follow `docs/STYLE.md`. Inter and Inter Tight are vendored in `vendor/fonts/` (SIL Open Font License), so the page loads no web fonts from a CDN.
- Browsers without WebGL get a message and a link to the Miscellaneous charts.

The summary under the map always describes the Auckland urban area, the area
the study uses, even when the map shows the whole region.
