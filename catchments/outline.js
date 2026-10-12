// Dissolve display polygons so included areas share one outline, with holes and islands.
((root, factory) => {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./vendor/polygon-clipping.min.js"));
  else root.CatchmentOutline = factory(root.polygonClipping);
})(typeof globalThis === "object" ? globalThis : this, clipping => ({
  merge(features, included) {
    const polygons = features.filter(f => included.has(f.properties.i)).map(f => f.geometry.coordinates);
    return { type: "MultiPolygon", coordinates: polygons.length ? clipping.union(...polygons) : [] };
  }
}));
