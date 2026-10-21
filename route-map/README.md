# Aviation Route Map

The public route map includes flat, polar, globe and world projections.
`write_site()` publishes this page and its projection code at `route-map/`,
with the shared route data, styles and parser. The former
`route-map-projections/` URL redirects there.

Projections:

- **Flat:** the current route map's projection, unchanged.
- **Polar:** azimuthal equidistant, centred on an airport (the busiest by
  default). Routes from the centre are straight lines at true distance. Shapes
  stretch towards the edge; the map stops 3° short of the far point.
- **Globe:** orthographic, centred on an airport. Always shows the whole disc;
  routes to the far side stop at the horizon.
- **World:** Equal Earth.

Australia/New Zealand and custom bounds apply only to the flat projection.

## Bundled sources

- [d3-geo 3.1.1](https://github.com/d3/d3-geo) and its dependency
  [d3-array 3.2.4](https://github.com/d3/d3-array), official minified builds
  from npm. ISC licence in `vendor/LICENSE.d3-geo` and `vendor/LICENSE.d3-array`.
  About 53 KB together. No CDN calls at runtime.
