/* SVG is the preview and the export source, so the downloaded map matches it. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id), M = RouteMap;
  const NS = "http://www.w3.org/2000/svg";
  let W = 1200, H = 750, export_width = 3840, export_height = 2160;
  let data, land, current_svg, upload_version = 0, export_busy = false;
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
  function export_size() {
    const custom = $("export-size").value === "custom";
    $("export-custom").hidden = !custom;
    const size = custom ? [$("export-width").value, $("export-height").value].map(Number) : $("export-size").value.split(',').map(Number);
    if (size.some(n => !Number.isInteger(n) || n < 100 || n > 8000) || size[0] * size[1] > 40000000) throw Error("Export size: use whole numbers from 100 to 8,000, up to 40 million pixels.");
    [export_width, export_height] = size;
    const ratio = export_width / export_height;
    W = Math.max(1200, 750 * ratio); H = W / ratio;
  }
  function render() {
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
      const legend_rows = legend.size > 1 ? Math.ceil(Math.min(legend.size, 20) / legend_columns) : 0;
      const reserve = 240 + legend_rows * 24 + (legend.size > 20 ? 24 : 0);
      for (const option of $("metric").options) {
        option.disabled = option.value !== "equal" && (totals.some(r => r[option.value] == null) || !totals.some(r => r[option.value] > 0));
      }
      if ($("metric").selectedOptions[0].disabled) $("metric").value = "equal";
      const metric = $("metric").value, routes = totals.filter(r => metric === "equal" || r[metric] > 0);
      const codes = [...new Set(routes.flatMap(r => [r.origin, r.destination]))];
      const arcs = routes.map(r => M.great_circle(data.airports.get(r.origin), data.airports.get(r.destination)));
      const bounds = extent(arcs.flat()), centre = (bounds[0] + bounds[1]) / 2;
      // A latitude-adjusted equirectangular projection keeps regional maps balanced.
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
      const left = (W - plot_width) / 2, top = 138 + (H - 240 - plot_height) / 2;
      const project = ([lon, lat]) => [left + (lon - bounds[0]) * aspect * scale, top + (bounds[3] - lat) * scale];
      const point = p => project([M.wrap(p[0], centre), p[1]]);
      const bg = $("background").value, colour = $("route-colour").value;
      const luminance = bg.slice(1).match(/../g).map(v => parseInt(v, 16)).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const light = luminance < 140, ink = light ? "#e6f3ff" : "#102b3c", muted = light ? "#9bb5c9" : "#405c6c";
      const svg = make("svg", { xmlns: NS, viewBox: `0 0 ${W} ${H}`, width: export_width, height: export_height, role: "img", "aria-labelledby": "map-title map-desc" });
      svg.append(make("title", { id: "map-title" }, $("title").value || "Airport connections"),
        make("desc", { id: "map-desc" }, `${routes.length} airport-pair connections. ${$("source").value}. Great-circle paths; not actual flight tracks.`));
      const defs = make("defs"), clip = make("clipPath", { id: "map-clip" });
      clip.append(make("rect", { x: left, y: top, width: plot_width, height: plot_height }));
      const glow = make("filter", { id: "route-glow", x: "-50%", y: "-50%", width: "200%", height: "200%" });
      glow.append(make("feGaussianBlur", { stdDeviation: 3 })); defs.append(clip, glow); svg.append(defs);
      svg.append(make("rect", { width: W, height: H, fill: bg }));
      const text = (x, y, size, value, fill = ink, attrs = {}) => make("text", { x, y, fill, "font-family": "Arial, sans-serif", "font-size": size, ...attrs }, value);
      svg.append(text(42, 40, 12, "ALTITUDE  /  AIRPORT CONNECTIVITY", muted, { "letter-spacing": 2.5 }),
        text(42, 85, 30, $("title").value || "Airport connections", ink, { "font-weight": 600 }),
        text(42, 112, 14, $("source").value || "Source: user-supplied route table", muted));
      const geography = make("g", { "clip-path": "url(#map-clip)" }); svg.append(geography);
      // Unwrap each land ring before projecting, then draw copies across the date line.
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
          geography.append(make("path", { d, fill: $("country-colour").value, stroke: light ? "#2c495d" : "#acbfcd", "stroke-width": .7, "fill-rule": "evenodd" }));
        }
      }
      const max = metric === "equal" ? 1 : Math.max(...routes.map(r => r[metric]));
      const route_layer = make("g", { "clip-path": "url(#map-clip)", fill: "none", "stroke-linecap": "round" }); svg.append(route_layer);
      routes.forEach((route, i) => {
        const colour = route_colour(route);
        // Separate paths at the projection seam rather than drawing across the map.
        let previous; const d = arcs[i].map(p => {
          const xy = point(p), move = !previous || Math.abs(xy[0] - previous[0]) > 180 * aspect * scale;
          previous = xy; return `${move ? "M" : "L"}${xy[0].toFixed(2)},${xy[1].toFixed(2)}`;
        }).join("");
        const width = Number($("width").value) * (metric === "equal" ? 1 : Math.max(.15, route[metric] / max) * 3);
        route_layer.append(make("path", { d, stroke: colour, "stroke-width": width + 4, opacity: .35, filter: "url(#route-glow)" }));
        const path = make("path", { d, stroke: colour, "stroke-width": width, opacity: .9 });
        path.append(make("title", {}, `${route.origin} ↔ ${route.destination}${metric === "equal" ? "" : `: ${route[metric].toLocaleString()} ${metric}`}`)); route_layer.append(path);
      });
      const boxes = [];
      const markers = make("g", { "clip-path": "url(#map-clip)" }); svg.append(markers);
      for (const code of codes) {
        const location = data.airports.get(code), [x, y] = point(location);
        if (x < left || x > left + plot_width || y < top || y > top + plot_height) continue;
        markers.append(make("circle", { cx: x, cy: y, r: 4.5, fill: ink, stroke: bg, "stroke-width": 1.5 }));
        if ($("labels").value === "none") continue;
        const label = $("labels").value === "names" && location[2] !== code ? `${location[2]} · ${code}` : code;
        const length = label.length * 8.4, height = 20;
        const candidates = [[x + 10, y - 10], [x + 10, y + 24], [x - length - 10, y - 10], [x - length - 10, y + 24], [x - length / 2, y - 28], [x - length / 2, y + 42]];
        const scored = candidates.map(([lx, ly]) => {
          const rect = [lx, ly - height, lx + length, ly + 4];
          const collisions = boxes.filter(b => rect[0] < b[2] + 4 && rect[2] > b[0] - 4 && rect[1] < b[3] + 4 && rect[3] > b[1] - 4).length;
          const outside = rect[0] < left || rect[2] > left + plot_width || rect[1] < top || rect[3] > top + plot_height;
          return { lx, ly, rect, score: collisions + (outside ? 100 : 0) };
        }).sort((a, b) => a.score - b.score)[0];
        boxes.push(scored.rect);
        markers.append(text(scored.lx, scored.ly, 15, label, ink, { "font-weight": 600, stroke: bg, "stroke-width": 4, "paint-order": "stroke" }));
      }
      if (legend.size > 1) {
        [...legend].slice(0, 20).forEach(([colour, label], i) => {
          const x = 42 + (i % legend_columns) * 240;
          const y = H - 90 - (legend_rows - 1 - Math.floor(i / legend_columns)) * 24;
          svg.append(make("line", {x1:x, x2:x+24, y1:y-4, y2:y-4, stroke:colour, "stroke-width":3}), text(x+32,y,12,label.slice(0,26),ink));
        });
        if (legend.size > 20) svg.append(text(42, H-66,12,`${legend.size-20} more colours - see route totals`,muted));
      }
      const note = metric === "equal" ? "Equal route widths" : `Width: ${metric} · largest pair ${max.toLocaleString()} ${metric}`;
      svg.append(text(42, H - 52, 14, `${routes.length} CONNECTIONS  /  ${codes.length} AIRPORTS`, ink, { "letter-spacing": 1 }),
        text(42, H - 27, 12, `${note}  ·  Great-circle connections; not flight tracks.  ·  Geography: Natural Earth`, muted));
      $("map").replaceChildren(svg); current_svg = svg;
      $("summary").textContent = `${routes.length} connections · ${codes.length} airports`;
      $("route-totals").replaceChildren(...totals.map(r => {
        const tr = document.createElement("tr");
        for (const value of [`${r.origin} ↔ ${r.destination}`, r.flights?.toLocaleString() ?? "Not supplied", r.seats?.toLocaleString() ?? "Not supplied", [...r.airlines].join(", ") || "Not supplied", route_colour(r)]) {
          const td = document.createElement("td"); td.textContent = value; tr.append(td);
        }
        return tr;
      }));
      enable_exports(true); message("Map ready. SVG and PNG include the title, source and route-width units.");
    } catch (e) { enable_exports(false); message(e.message, true); }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const svg_blob = () => new Blob([new XMLSerializer().serializeToString(current_svg)], { type: "image/svg+xml;charset=utf-8" });
  $("svg-export").addEventListener("click", () => download(svg_blob(), "altitude-route-map.svg"));
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
      const response = await fetch("sample.csv"); if (!response.ok) throw Error("Could not load the example.");
      const next = M.normalise(M.parse_csv(await response.text()));
      if (version === upload_version) install(next, "Queenstown example", true);
    } catch (e) { message(e.message, true); }
  }
  $("example").addEventListener("click", example);
  async function start() {
    try {
      const response = await fetch("land.geojson"); if (!response.ok) throw Error("Could not load geography. Reload the page.");
      land = await response.json();
      const lookup = await fetch("airports.json"); if (!lookup.ok) throw Error("Could not load airport lookup. Reload the page.");
      M.set_airports(await lookup.json());
      $("draw-routes").disabled = false;
      await example();
    } catch (e) { message(e.message, true); }
  }
  start();
})();
