/* Aviation route map with d3-geo for polar, globe and world views.
   SVG is the preview and the export source, so the downloaded map matches it. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id), M = RouteMap;
  const NS = "http://www.w3.org/2000/svg";
  let W = 1200, H = 750, export_width = 3840, export_height = 2160;
  let data, land, current_svg, upload_version = 0, export_busy = false;
  // Pan and zoom, in SVG units, applied after the automatic fit: screen = fitted * k + (x, y).
  let view = { k: 1, x: 0, y: 0 };
  const make = (tag, attrs = {}, text = "") => {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    return node;
  };
  function message(text, error = false) {
    $("status").textContent = text; $("status").classList.toggle("error", error);
  }
  function enable_exports(enabled) {
    for (const id of ["svg-export", "png-export"]) $(id).disabled = !enabled || export_busy;
  }
  function install(next, name, demo = false) {
    data = next;
    $("airline").replaceChildren(new Option("All airlines", ""),
      ...[...new Set(data.routes.map(r => r.airline).filter(Boolean))].sort().map(a => new Option(a, a)));
    $("source").value = demo ? "Demonstration data · illustrative annual seats and flights" : `Source: ${name.slice(0, 65)} · add your period`;
    $("title").value = demo ? "Queenstown connections" : "Airport connections";
    $("extent").value = "auto";
    $("metric").value = "equal";
    view = { k: 1, x: 0, y: 0 };
    const codes = [...new Set(data.routes.flatMap(r => [r.origin, r.destination]))].sort();
    $("centre").replaceChildren(new Option("Busiest airport", ""), ...codes.map(c => new Option(c, c)));
    render();
    message(demo ? "Example only: these figures do not describe a published airline schedule." : `Opened ${name}. Your file has stayed in this browser.`);
  }
  function extent(points) {
    switch ($("extent").value) {
      case "tasman": return [110, 181, -49, -10];
      case "world": return [-180, 180, -85, 85];
      case "custom": {
        const ids = ["west", "east", "south", "north"], bounds = ids.map(id => Number($(id).value));
        if (ids.some(id => !$(id).value.trim() || !$(id).checkValidity()) || bounds[1] <= bounds[0] || bounds[1] - bounds[0] > 360 || bounds[3] <= bounds[2]) {
          throw Error("Custom bounds: east must be greater than west (span at most 360°), and north greater than south.");
        }
        return bounds;
      }
      default: return M.fit_extent(points);
    }
  }
  // The current map: a latitude-adjusted equirectangular projection, unchanged.
  function flat_frame(arcs, rings, reserve, head) {
    // Rings are left out of the fit so adding or changing them never moves the map.
    const fit_points = arcs.flat();
    const bounds = extent(fit_points.length ? fit_points : rings.flatMap(ring => ring.points)), centre = (bounds[0] + bounds[1]) / 2;
    const aspect = Math.max(.25, Math.cos((bounds[2] + bounds[3]) / 2 * Math.PI / 180));
    const scale = Math.min((W - 140) / ((bounds[1] - bounds[0]) * aspect), (H - reserve) / (bounds[3] - bounds[2]));
    // Fill the preview with context land, rather than an inset clipped rectangle.
    if ($("extent").value === "auto") {
      const middle_lat = (bounds[2] + bounds[3]) / 2;
      const span = Math.min(360, (W - 84) / (aspect * scale));
      bounds[0] = centre - span / 2; bounds[1] = centre + span / 2;
      bounds[2] = Math.max(-90, middle_lat - (H - reserve) / scale / 2);
      bounds[3] = Math.min(90, middle_lat + (H - reserve) / scale / 2);
    }
    const plot_width = (bounds[1] - bounds[0]) * aspect * scale, plot_height = (bounds[3] - bounds[2]) * scale;
    const left = (W - plot_width) / 2, top = head + (H - reserve - plot_height) / 2;
    const project = ([lon, lat]) => [view.x + view.k * (left + (lon - bounds[0]) * aspect * scale), view.y + view.k * (top + (bounds[3] - lat) * scale)];
    const point = p => project([M.wrap(p[0], centre), p[1]]);
    // Unwrap each land ring before projecting, then draw copies across the date line.
    const land_paths = [];
    for (const feature of land.features) {
      const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const polygon of polygons) for (const shift of [-360, 0, 360]) {
        let d = "";
        for (const ring of polygon) {
          let previous = M.wrap(ring[0][0], centre);
          d += ring.map((p, i) => {
            const lon = i ? previous + M.wrap(p[0] - previous, 0) : previous;
            previous = lon; const [x, y] = project([lon + shift, p[1]]);
            return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
          }).join("") + "Z";
        }
        land_paths.push(d);
      }
    }
    // Separate paths at the projection seam rather than drawing across the map.
    const route = i => {
      let previous; return arcs[i].map(p => {
        const xy = point(p), move = !previous || Math.abs(xy[0] - previous[0]) > 180 * aspect * scale * view.k;
        previous = xy; return `${move ? "M" : "L"}${xy[0].toFixed(2)},${xy[1].toFixed(2)}`;
      }).join("");
    };
    const ring = points => {
      let previous;
      return points.map((p, i) => {
        const longitude = i ? previous + M.wrap(p[0] - previous, 0) : M.wrap(p[0], centre);
        previous = longitude; const [x, y] = project([longitude, p[1]]);
        return `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
      }).join("") + "Z";
    };
    return { left, top, plot_width, plot_height, land: land_paths, route, ring, point };
  }
  // The airport with the most connections centres the polar and globe views.
  function busiest(routes) {
    const counts = new Map();
    for (const r of routes) for (const c of [r.origin, r.destination]) counts.set(c, (counts.get(c) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  // Polar, globe and world views. d3-geo clips land and paths at the horizon and the date line.
  function round_frame(routes, rings, centre, reserve, head) {
    const mode = $("projection").value, sphere = { type: "Sphere" };
    const lines = routes.map(r => [data.airports.get(r.origin), data.airports.get(r.destination)]);
    // Polar stops just short of the far point, where land shapes can't be drawn reliably.
    const projection = mode === "polar" ? d3.geoAzimuthalEquidistant().rotate([-centre[0], -centre[1]]).clipAngle(177)
      : mode === "globe" ? d3.geoOrthographic().rotate([-centre[0], -centre[1]])
      : d3.geoEqualEarth().rotate([-M.fit_extent(lines.flat()).slice(0, 2).reduce((a, b) => a + b) / 2, 0]);
    const left = 70, top = head, plot_width = W - 140, plot_height = H - reserve;
    // A globe always shows its whole disc; a part-globe crops awkwardly.
    const whole = mode === "globe" || $("extent").value === "world" || !lines.length;
    // Rings are left out of the fit so adding or changing them never moves the map.
    projection.precision(.2).fitExtent([[left + 30, top + 20], [left + plot_width - 30, top + plot_height - 20]],
      whole ? sphere : { type: "MultiLineString", coordinates: lines });
    const fitted = projection.translate();
    projection.scale(projection.scale() * view.k).translate([fitted[0] * view.k + view.x, fitted[1] * view.k + view.y]);
    const path = d3.geoPath(projection), rotate = projection.rotate(), facing = [-rotate[0], -rotate[1]];
    // Airports on the far side of the globe are hidden.
    const point = p => mode === "globe" && d3.geoDistance(p, facing) > Math.PI / 2 - 1e-6 ? null : projection(p);
    return { left, top, plot_width, plot_height, point,
      sphere: path(sphere), grid: $("grid").value === "show" ? path(d3.geoGraticule10()) : "",
      land: [path(land)].filter(Boolean), route: i => path({ type: "LineString", coordinates: lines[i] }),
      ring: points => path({ type: "Polygon", coordinates: [[...points, points[0]]] }) };
  }
  function export_size() {
    const custom = $("export-size").value === "custom";
    $("export-custom").hidden = !custom;
    const size = custom ? [$("export-width").value, $("export-height").value].map(Number) : $("export-size").value.split(',').map(Number);
    if (size.some(n => !Number.isInteger(n) || n < 100 || n > 8000) || size[0] * size[1] > 40000000) throw Error("Export size: use whole numbers from 100 to 8,000, up to 40 million pixels.");
    [export_width, export_height] = size;
    const ratio = export_width / export_height;
    W = Math.max(1200, 750 * ratio); H = W / ratio;
  }
  const ring_limits = { km: 20000, miles: 12400, nautical_miles: 10800 };
  const unit_names = { km: "km", miles: "miles", nautical_miles: "nautical miles" };
  const MAX_RINGS = 60;
  let ring_rows = 0;
  // One row per set of rings: every airport in the row gets a ring at every distance.
  function add_ring_row(airports = "", distances = "", unit = "km") {
    const n = ++ring_rows, row = document.createElement("div");
    row.className = "ring-row";
    row.innerHTML = `<div class="pair"><div><label for="ring-airports-${n}">Airport codes</label><input id="ring-airports-${n}" class="ring-airports" maxlength="240" placeholder="AKL, ZQN" autocomplete="off"></div>
      <div><label for="ring-distances-${n}">Distances</label><input id="ring-distances-${n}" class="ring-distances" maxlength="120" placeholder="500, 1000" inputmode="decimal" autocomplete="off"></div></div>
      <div class="ring-foot"><label class="sr-only" for="ring-unit-${n}">Units</label><select id="ring-unit-${n}" class="ring-unit"><option value="km">Kilometres</option><option value="miles">Miles</option><option value="nautical_miles">Nautical miles</option></select><button type="button" class="ring-remove" aria-label="Remove this row of rings">Remove</button></div>`;
    row.querySelector(".ring-airports").value = airports;
    row.querySelector(".ring-distances").value = distances;
    row.querySelector(".ring-unit").value = unit;
    row.querySelector(".ring-remove").addEventListener("click", () => {
      row.remove(); if (!$("ring-list").children.length) add_ring_row(); render();
    });
    $("ring-list").append(row);
    return row;
  }
  function distance_rings() {
    const rings = [], seen = new Set();
    for (const row of $("ring-list").children) {
      const codes = row.querySelector(".ring-airports").value.toUpperCase().split(/[\s,]+/).filter(Boolean);
      const values = row.querySelector(".ring-distances").value.split(/[\s,;]+/).filter(Boolean);
      const unit = row.querySelector(".ring-unit").value, limit = ring_limits[unit];
      if (!values.length && !codes.length) continue;
      const distances = values.map(v => Number(v.replace(/_/g, "")));
      if (!values.length || distances.some(d => !Number.isFinite(d) || d <= 0 || d > limit)) throw Error(`Distance rings: use distances from 1 to ${limit.toLocaleString()} ${unit_names[unit]}.`);
      if (!codes.length) throw Error("Distance rings: enter at least one airport code in each row.");
      const unknown = [...new Set(codes.filter(code => !data.airports.has(code)))];
      if (unknown.length) throw Error(`Distance rings: unknown airport codes: ${unknown.join(", ")}.`);
      for (const code of new Set(codes)) for (const distance of new Set(distances)) {
        const key = `${code}|${distance}|${unit}`; if (seen.has(key)) continue; seen.add(key);
        rings.push({ code, distance, unit, points: M.distance_circle(data.airports.get(code), distance, unit) });
      }
    }
    if (rings.length > MAX_RINGS) throw Error(`Distance rings: draw at most ${MAX_RINGS} rings at once.`);
    return rings;
  }
  function render() {
    const mode = $("projection").value, round = mode !== "flat";
    // Regional presets and lat/long bounds only make sense on the flat map.
    for (const value of ["tasman", "custom"]) $("extent").querySelector(`[value=${value}]`).disabled = round;
    if (round && ["tasman", "custom"].includes($("extent").value)) $("extent").value = "auto";
    $("round-options").hidden = !round;
    $("centre").disabled = mode === "world";
    $("projection-hint").textContent = { polar: "Routes from the centre airport are straight lines at true distance. Shapes stretch towards the edge.",
      globe: "Shows the half of the world facing the centre airport. Routes to the far side stop at the horizon.", world: "Whole-world view with areas in proportion." }[mode] || "";
    $("bounds").hidden = $("extent").value !== "custom";
    $("width-value").value = $("width").value;
    if (!data || !land) return;
    try {
      export_size();
      const colour_by = $("colour-by").value;
      const totals = M.aggregate(data.routes, $("airline").value, colour_by);
      const airline_names = [...new Set(data.routes.map(r => r.airline || "Not supplied"))].sort();
      const route_colour = route => colour_by === "airline"
        ? `hsl(${airline_names.indexOf(route.airline || "Not supplied") * 137.508 % 360}, 75%, 60%)`
        : colour_by === "route" ? route.colour || $("route-colour").value : $("route-colour").value;
      const legend = new Map();
      for (const route of totals) {
        const colour = route_colour(route);
        legend.set(colour, colour_by === "airline" ? route.airline || "Not supplied" : colour);
      }
      const legend_columns = Math.max(1, Math.floor((W - 84) / 240));
      // "Map only" drops the title, source, legend and notes so the map fills the image.
      const words = $("map-text").value === "full";
      const legend_rows = words && legend.size > 1 ? Math.ceil(Math.min(legend.size, 20) / legend_columns) : 0;
      const head = words ? 138 : 24;
      const reserve = words ? 240 + legend_rows * 24 + (legend.size > 20 ? 24 : 0) : 48;
      for (const option of $("metric").options) {
        option.disabled = option.value !== "equal" && (totals.some(r => r[option.value] == null) || !totals.some(r => r[option.value] > 0));
      }
      if ($("metric").selectedOptions[0].disabled) $("metric").value = "equal";
      const metric = $("metric").value, routes = totals.filter(r => metric === "equal" || r[metric] > 0);
      const codes = [...new Set(routes.flatMap(r => [r.origin, r.destination]))];
      const arcs = routes.map(r => M.great_circle(data.airports.get(r.origin), data.airports.get(r.destination)));
      const rings = distance_rings();
      const centre_code = $("centre").value || (routes.length ? busiest(routes) : codes[0]);
      const frame = mode === "flat" ? flat_frame(arcs, rings, reserve, head) : round_frame(routes, rings, data.airports.get(centre_code), reserve, head);
      const { left, top, plot_width, plot_height } = frame;
      const bg = $("background").value, colour = $("route-colour").value;
      const luminance = bg.slice(1).match(/../g).map(v => parseInt(v, 16)).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const light = luminance < 140, ink = light ? "#e6f3ff" : "#102b3c", muted = light ? "#9bb5c9" : "#405c6c";
      const svg = make("svg", { xmlns: NS, viewBox: `0 0 ${W} ${H}`, width: export_width, height: export_height, overflow: "hidden", role: "img", "aria-labelledby": "map-title map-desc" });
      svg.append(make("title", { id: "map-title" }, $("title").value || "Airport connections"),
        make("desc", { id: "map-desc" }, `${routes.length} airport-pair connections. ${$("source").value}. Great-circle paths; not actual flight tracks.`));
      const defs = make("defs"), clip = make("clipPath", { id: "map-clip" });
      clip.append(make("rect", { x: left, y: top, width: plot_width, height: plot_height }));
      defs.append(clip); svg.append(defs);
      svg.append(make("rect", { width: W, height: H, fill: bg, "data-background": "true" }));
      const text = (x, y, size, value, fill = ink, attrs = {}) => make("text", { x, y, fill, "font-family": "Arial, sans-serif", "font-size": size, ...attrs }, value);
      if (words) svg.append(text(42, 40, 12, "ALTITUDE  /  AIRPORT CONNECTIVITY", muted, { "letter-spacing": 2.5 }),
        text(42, 85, 30, $("title").value || "Airport connections", ink, { "font-weight": 600 }),
        text(42, 112, 14, $("source").value || "Source: user-supplied route table", muted));
      const geography = make("g", { "clip-path": "url(#map-clip)" }); svg.append(geography);
      if (frame.sphere) geography.append(make("path", { d: frame.sphere, fill: "none", stroke: muted, "stroke-opacity": .6, "stroke-width": 1.2 }));
      if (frame.grid) geography.append(make("path", { d: frame.grid, fill: "none", stroke: muted, "stroke-opacity": .25, "stroke-width": .6 }));
      for (const d of frame.land) geography.append(make("path", { d, fill: light ? "#152e40" : "#d6e2e9", stroke: light ? "#2c495d" : "#acbfcd", "stroke-width": .7, "fill-rule": "evenodd" }));
      const ring_colour = light ? "#8fd3cf" : "#0e6b6b";
      if (rings.length && $("shade-outside-rings").checked) {
        const mask = make("mask", { id: "outside-rings", maskUnits: "userSpaceOnUse", x: left, y: top, width: plot_width, height: plot_height });
        mask.append(make("rect", { x: left, y: top, width: plot_width, height: plot_height, fill: "white" }));
        rings.forEach(ring => mask.append(make("path", { d: frame.ring(ring.points), fill: "black" })));
        defs.append(mask);
        svg.append(make("rect", { x: left, y: top, width: plot_width, height: plot_height, fill: light ? "#081827" : "#12243d", opacity: .52, mask: "url(#outside-rings)", "clip-path": "url(#map-clip)" }));
      }
      if (rings.length) {
        const ring_layer = make("g", { "clip-path": "url(#map-clip)", fill: "none", stroke: ring_colour }); svg.append(ring_layer);
        // Label each ring at the visible point nearest its northern edge that clears the other ring labels.
        const placed = [], order = [0];
        for (let step = 4; step <= 72; step += 4) order.push(step, -step);
        rings.forEach(ring => {
          ring_layer.append(make("path", { d: frame.ring(ring.points), "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
          const label = `${ring.code} · ${ring.distance.toLocaleString()} ${ring.unit === "km" ? "km" : ring.unit === "miles" ? "mi" : "nm"}`;
          const length = label.length * 7, count = ring.points.length;
          let spot = null;
          for (const offset of order) {
            const xy = frame.point(ring.points[(offset + count) % count]); if (!xy) continue;
            const box = [xy[0] + 8, xy[1] - 20, xy[0] + 8 + length, xy[1] - 4];
            if (box[0] < left + 4 || box[2] > left + plot_width - 4 || box[1] < top + 4 || box[3] > top + plot_height - 4) continue;
            if (placed.some(o => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
            spot = box; break;
          }
          if (!spot) return;
          placed.push(spot);
          const lx = spot[0], ly = spot[3] - 4;
          ring_layer.append(text(lx, ly, 12, label, bg, { "font-weight": 600, stroke: bg, "stroke-width": 3, "paint-order": "stroke", "data-background-halo": "true", "aria-hidden": "true" }),
            text(lx, ly, 12, label, ring_colour, { "font-weight": 600 }));
        });
      }
      const max = metric === "equal" ? 1 : Math.max(...routes.map(r => r[metric]));
      const route_layer = make("g", { "clip-path": "url(#map-clip)", fill: "none", "stroke-linecap": "round" }); svg.append(route_layer);
      routes.forEach((route, i) => {
        const colour = route_colour(route);
        const d = frame.route(i); if (!d) return;
        const width = Number($("width").value) * (metric === "equal" ? 1 : Math.max(.15, route[metric] / max) * 3);
        const path = make("path", { d, stroke: colour, "stroke-width": width, opacity: .9 });
        path.append(make("title", {}, `${route.origin} ↔ ${route.destination}${metric === "equal" ? "" : `: ${route[metric].toLocaleString()} ${metric}`}`)); route_layer.append(path);
      });
      // Dots go below every label, and labels avoid the dots as well as each other.
      const highlight = new Set($("highlight").value.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
      const accent = $("highlight-colour").value;
      const markers = make("g", { "clip-path": "url(#map-clip)" }), labels = make("g", { "clip-path": "url(#map-clip)" });
      svg.append(markers, labels);
      const places = [], boxes = [];
      for (const code of codes) {
        const location = data.airports.get(code), xy = frame.point(location);
        if (!xy) continue;
        const [x, y] = xy, key = highlight.has(code) || highlight.has(location[2]?.toUpperCase());
        if (x < left || x > left + plot_width || y < top || y > top + plot_height) continue;
        const r = key ? 7.5 : 4.5;
        if (key) markers.append(make("circle", { cx: x, cy: y, r: r + 5, fill: "none", stroke: accent, "stroke-width": 2 }));
        markers.append(make("circle", { cx: x, cy: y, r, fill: key ? accent : ink, stroke: bg, "stroke-width": 1.5 }));
        boxes.push([x - r - 5, y - r - 5, x + r + 5, y + r + 5]);
        places.push({ code, location, x, y, key });
      }
      // Highlighted airports choose their label position first.
      if ($("labels").value !== "none") for (const { code, location, x, y, key } of places.sort((a, b) => b.key - a.key)) {
        const label = $("labels").value === "names" && location[2] !== code ? `${location[2]} · ${code}` : code;
        const size = key ? 19 : 15, length = label.length * size * .56, height = size + 5, gap = key ? 14 : 10;
        const candidates = [[x + gap, y - gap], [x + gap, y + gap + size], [x - length - gap, y - gap], [x - length - gap, y + gap + size], [x - length / 2, y - gap - 16], [x - length / 2, y + gap + size + 16]];
        const scored = candidates.map(([lx, ly]) => {
          const rect = [lx, ly - height, lx + length, ly + 4];
          const collisions = boxes.filter(b => rect[0] < b[2] + 4 && rect[2] > b[0] - 4 && rect[1] < b[3] + 4 && rect[3] > b[1] - 4).length;
          const outside = rect[0] < left || rect[2] > left + plot_width || rect[1] < top || rect[3] > top + plot_height;
          return { lx, ly, rect, score: collisions + (outside ? 100 : 0) };
        }).sort((a, b) => a.score - b.score)[0];
        boxes.push(scored.rect);
        // The halo is its own text element below the label: PowerPoint, Illustrator and some
        // viewers ignore paint-order and would draw the outline over the letters.
        const weight = { "font-weight": key ? 700 : 600 };
        labels.append(text(scored.lx, scored.ly, size, label, bg, { ...weight, stroke: bg, "stroke-width": 4, "stroke-linejoin": "round", "data-background-halo": "true", "aria-hidden": "true" }),
          text(scored.lx, scored.ly, size, label, key ? accent : ink, weight));
      }
      if (words && legend.size > 1) {
        [...legend].slice(0, 20).forEach(([colour, label], i) => {
          const x = 42 + (i % legend_columns) * 240;
          const y = H - 90 - (legend_rows - 1 - Math.floor(i / legend_columns)) * 24;
          svg.append(make("line", {x1:x, x2:x+24, y1:y-4, y2:y-4, stroke:colour, "stroke-width":3}), text(x+32,y,12,label.slice(0,26),ink));
        });
        if (legend.size > 20) svg.append(text(42, H-66,12,`${legend.size-20} more colours - see route totals`,muted));
      }
      const note = metric === "equal" ? "Equal route widths" : `Width: ${metric} · largest pair ${max.toLocaleString()} ${metric}`;
      if (words) svg.append(text(42, H - 52, 14, `${routes.length} CONNECTIONS  /  ${codes.length} AIRPORTS`, ink, { "letter-spacing": 1 }),
        text(42, H - 27, 12, `${note}  ·  Great-circle connections; not flight tracks.  ·  Geography: Natural Earth`, muted));
      $("map").replaceChildren(svg); current_svg = svg;
      $("reset-view").disabled = view.k === 1 && view.x === 0 && view.y === 0;
      $("summary").textContent = `${routes.length} connections · ${codes.length} airports`;
      $("route-totals").replaceChildren(...totals.map(r => {
        const tr = document.createElement("tr");
        const distance = Math.round(M.great_circle_distance(data.airports.get(r.origin), data.airports.get(r.destination))).toLocaleString();
        for (const value of [`${r.origin} ↔ ${r.destination}`, distance, r.flights?.toLocaleString() ?? "Not supplied", r.seats?.toLocaleString() ?? "Not supplied", [...r.airlines].join(", ") || "Not supplied", route_colour(r)]) {
          const td = document.createElement("td"); td.textContent = value; tr.append(td);
        }
        return tr;
      }));
      enable_exports(true); message(words ? "Map ready. SVG and PNG include the title, source and route-width units." : "Map ready. Downloads show the map only, with no title, source or notes.");
    } catch (e) { enable_exports(false); message(e.message, true); }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function svg_blob(transparent = false) {
    const svg = current_svg.cloneNode(true);
    if (transparent) svg.querySelectorAll("[data-background], [data-background-halo]").forEach(node => node.remove());
    return new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" });
  }
  $("svg-export").addEventListener("click", () => download(svg_blob($("transparent-svg").checked), "altitude-route-map.svg"));
  $("png-export").addEventListener("click", async () => {
    const size = [export_width, export_height];
    const print_size = ["3508,2480", "4961,3508"].includes($("export-size").value);
    const url = URL.createObjectURL(svg_blob()); export_busy = true; enable_exports(false);
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = size[0]; canvas.height = size[1];
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw Error("PNG could not be created. Try the SVG download.");

      const output = print_size ? new Blob([M.png_dpi(new Uint8Array(await blob.arrayBuffer()), 300)], {type: "image/png"}) : blob;
      download(output, "altitude-route-map.png"); message(`PNG downloaded at ${size[0]} x ${size[1]} pixels.`);
    } catch (e) { message(`Export failed: ${e.message}`, true); }
    finally { URL.revokeObjectURL(url); export_busy = false; enable_exports(Boolean(current_svg)); }
  });
  $("controls").addEventListener("submit", e => e.preventDefault());
  $("controls").addEventListener("input", e => { if (!["upload", "typed-routes"].includes(e.target.id)) render(); });
  $("draw-routes").addEventListener("click", () => {
    try { const next = M.parse_routes($("typed-routes").value); ++upload_version; install(next, "Typed route list"); }
    catch (e) { message(`${e.message} Previous map retained.`, true); }
  });
  $("upload").addEventListener("change", async () => {
    const file = $("upload").files[0]; if (!file) return;
    const version = ++upload_version;
    try {
      if (file.size > 5 * 1024 * 1024) throw Error("Use a file smaller than 5 MB.");
      if (!/\.(csv|xlsx)$/i.test(file.name)) throw Error("Choose a .csv or .xlsx file.");
      message(`Reading ${file.name} locally…`);
      let table;
      if (/\.csv$/i.test(file.name)) table = M.parse_csv(await file.text());
      else {
        if (typeof XLSX === "undefined") throw Error("The Excel reader is unavailable. Try CSV or reload the page.");
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", sheetRows: M.MAX_ROWS + 2, cellFormula: false, cellHTML: false });
        if (!workbook.SheetNames.length) throw Error("The workbook has no worksheets.");
        table = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true, blankrows: false });
      }
      const next = M.normalise(table);
      if (version === upload_version) install(next, file.name);
    } catch (e) { if (version === upload_version) message(`${e.message} Previous map retained.`, true); }
    finally { $("upload").value = ""; }
  });
  async function example() {
    const version = ++upload_version;
    try {
      const response = await fetch("./sample.csv"); if (!response.ok) throw Error("Could not load the example.");
      const next = M.normalise(M.parse_csv(await response.text()));
      if (version === upload_version) install(next, "Queenstown example", true);
    } catch (e) { message(e.message, true); }
  }
  $("example").addEventListener("click", example);
  async function start() {
    try {
      const response = await fetch("./land.geojson"); if (!response.ok) throw Error("Could not load geography. Reload the page.");
      land = await response.json();
      const lookup = await fetch("./airports.json"); if (!lookup.ok) throw Error("Could not load airport lookup. Reload the page.");
      M.set_airports(await lookup.json());
      $("draw-routes").disabled = false;
      await example();
    } catch (e) { message(e.message, true); }
  }
  // Help tips sit in a fixed layer so they never run off a narrow screen.
  let open_tip = null;
  const hide_tip = () => { if (!open_tip) return; open_tip.classList.remove("open"); open_tip.previousElementSibling.setAttribute("aria-expanded", "false"); open_tip = null; };
  const show_tip = button => {
    const tip = button.nextElementSibling; if (open_tip === tip || !tip.textContent.trim()) return;
    hide_tip(); tip.classList.add("open"); button.setAttribute("aria-expanded", "true"); open_tip = tip;
    const b = button.getBoundingClientRect(), t = tip.getBoundingClientRect();
    const left = Math.max(12, Math.min(innerWidth - t.width - 12, b.left - 12));
    const below = b.bottom + 6, top = below + t.height > innerHeight - 12 && b.top - t.height - 6 > 12 ? b.top - t.height - 6 : below;
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  };
  document.querySelectorAll(".help").forEach(button => {
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") show_tip(button); });
    button.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") hide_tip(); });
    button.addEventListener("focus", () => show_tip(button)); button.addEventListener("blur", hide_tip);
    // Inside a label a click would also toggle its field, so keep the click on the button.
    // Tapping shows the tip; tapping elsewhere (blur) hides it.
    button.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); show_tip(button); });
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") hide_tip(); });
  addEventListener("scroll", hide_tip, { passive: true }); addEventListener("resize", hide_tip);
  // Pan and zoom. Each change redraws the map, so the preview and downloads always match.
  let frame_pending = false;
  const redraw = () => { if (frame_pending) return; frame_pending = true; requestAnimationFrame(() => { frame_pending = false; render(); }); };
  const to_svg = (clientX, clientY) => {
    const rect = current_svg.getBoundingClientRect();
    return [(clientX - rect.left) * W / rect.width, (clientY - rect.top) * H / rect.height];
  };
  const zoom_at = (factor, [px, py]) => {
    const k = Math.max(.2, Math.min(40, view.k * factor)); factor = k / view.k;
    view = { k, x: px + (view.x - px) * factor, y: py + (view.y - py) * factor };
    redraw();
  };
  const reset_view = () => { view = { k: 1, x: 0, y: 0 }; redraw(); };
  const pointers = new Map();
  let gesture = null;
  const pinch = () => {
    const [a, b] = [...pointers.values()];
    return { mid: to_svg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), gap: Math.hypot(a[0] - b[0], a[1] - b[1]) };
  };
  $("map").addEventListener("pointerdown", e => {
    if (!current_svg || e.button > 0) return;
    $("map").setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
    $("map").classList.add("dragging");
    gesture = pointers.size === 2 ? pinch() : null;
  });
  $("map").addEventListener("pointermove", e => {
    if (!pointers.has(e.pointerId)) return;
    const previous = pointers.get(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) {
      const scale = W / current_svg.getBoundingClientRect().width;
      view.x += (e.clientX - previous[0]) * scale; view.y += (e.clientY - previous[1]) * scale; redraw();
    } else if (pointers.size === 2 && gesture) {
      const next = pinch();
      view.x += next.mid[0] - gesture.mid[0]; view.y += next.mid[1] - gesture.mid[1];
      gesture = next.gap && gesture.gap ? (zoom_at(next.gap / gesture.gap, next.mid), next) : next;
      redraw();
    }
  });
  const release = e => {
    pointers.delete(e.pointerId); gesture = pointers.size === 2 ? pinch() : null;
    if (!pointers.size) $("map").classList.remove("dragging");
  };
  $("map").addEventListener("pointerup", release); $("map").addEventListener("pointercancel", release);
  $("map").addEventListener("wheel", e => {
    if (!current_svg) return; e.preventDefault();
    zoom_at(Math.exp(-Math.max(-100, Math.min(100, e.deltaMode ? e.deltaY * 33 : e.deltaY)) * .002), to_svg(e.clientX, e.clientY));
  }, { passive: false });
  $("map").addEventListener("dblclick", e => { if (current_svg) zoom_at(e.shiftKey ? .5 : 2, to_svg(e.clientX, e.clientY)); });
  const centre_point = () => [W / 2, H / 2];
  $("zoom-in").addEventListener("click", () => zoom_at(1.5, centre_point()));
  $("zoom-out").addEventListener("click", () => zoom_at(1 / 1.5, centre_point()));
  $("reset-view").addEventListener("click", reset_view);
  // A new projection, centre or extent starts from a fresh automatic fit.
  for (const id of ["projection", "centre", "extent", "west", "east", "south", "north"]) $(id).addEventListener("input", () => { view = { k: 1, x: 0, y: 0 }; }, true);
  $("add-ring").addEventListener("click", () => add_ring_row().querySelector("input").focus());
  add_ring_row();
  start();
})();
