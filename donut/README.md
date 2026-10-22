# Where Auckland builds (3D map, Beta)

A static page for the Auckland donut study (E11). It steps through the same
story as the three "Auckland's missing middle" charts (E11f):

1. People per hectare: a light grey bar for the 2013 density, with the change
   to 2023 stacked on top (light teal for a gain, red for a loss), at 70% opacity.
2. Where the people added went: each area's share of 2013 residents (light grey) and
   of the people added by 2023 (navy, or red for a loss), on one scale.
3. Growth a year, faster (navy) or slower (teal) than the area as a whole, or a
   loss (red). Deeper shades are further from the average. Areas with fewer
   than 100 residents in 2013 are left off.
4. New homes consented between two years the reader picks, beside people in
   2023, as totals or per hectare.

Each colour in the key is a button that hides or shows those bars.
Rings mark the charts' 2 km bands, with 2, 6, 10, 18 and 30 km emphasised.
The inner suburbs (2–6 km) and everything beyond 18 km are shaded. Bars stop at
8 km high so a few very dense areas don't hide the rest; the key says how many.

- `data/donut.json` is written by `run_donut_analysis()` (`analysis/donut/donut_analysis.R`).
  Do not edit it by hand.
- `donut.js` is the pure logic (totals, bands, half-distances, scales). It also loads
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
