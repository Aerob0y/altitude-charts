/* SVG is the preview and the export source, so the downloaded map matches it. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id), M = RouteMap;
  const NS = "http://www.w3.org/2000/svg", W = 1200, H = 750;
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
  function render() {
    $("bounds").hidden = $("extent").value !== "custom";
    $("width-value").value = $("width").value;
    if (!data || !land) return;
    try {
      const totals = M.aggregate(data.routes, $("airline").value);
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
      const scale = Math.min((W - 140) / ((bounds[1] - bounds[0]) * aspect), (H - 240) / (bounds[3] - bounds[2]));
      // Fill the preview with context land, rather than an inset clipped rectangle.
      if ($("extent").value === "auto") {
        const middle_lat = (bounds[2] + bounds[3]) / 2;
        const span = Math.min(360, (W - 84) / (aspect * scale));
        bounds[0] = centre - span / 2; bounds[1] = centre + span / 2;
        bounds[2] = Math.max(-90, middle_lat - (H - 240) / scale / 2);
        bounds[3] = Math.min(90, middle_lat + (H - 240) / scale / 2);
      }
      const plot_width = (bounds[1] - bounds[0]) * aspect * scale, plot_height = (bounds[3] - bounds[2]) * scale;
      const left = (W - plot_width) / 2, top = 138 + (H - 240 - plot_height) / 2;
      const project = ([lon, lat]) => [left + (lon - bounds[0]) * aspect * scale, top + (bounds[3] - lat) * scale];
      const point = p => project([M.wrap(p[0], centre), p[1]]);
      const bg = $("background").value, colour = $("route-colour").value;
      const luminance = bg.slice(1).match(/../g).map(v => parseInt(v, 16)).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const light = luminance < 140, ink = light ? "#e6f3ff" : "#102b3c", muted = light ? "#9bb5c9" : "#405c6c";
      const svg = make("svg", { xmlns: NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-labelledby": "map-title map-desc" });
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
          geography.append(make("path", { d, fill: light ? "#152e40" : "#d6e2e9", stroke: light ? "#2c495d" : "#acbfcd", "stroke-width": .7, "fill-rule": "evenodd" }));
        }
      }
      const max = metric === "equal" ? 1 : Math.max(...routes.map(r => r[metric]));
      const route_layer = make("g", { "clip-path": "url(#map-clip)", fill: "none", "stroke-linecap": "round" }); svg.append(route_layer);
      routes.forEach((route, i) => {
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
      const note = metric === "equal" ? "Equal route widths" : `Width: ${metric} · largest pair ${max.toLocaleString()} ${metric}`;
      svg.append(text(42, H - 52, 14, `${routes.length} CONNECTIONS  /  ${codes.length} AIRPORTS`, ink, { "letter-spacing": 1 }),
        text(42, H - 27, 12, `${note}  ·  Great-circle connections; not flight tracks.  ·  Geography: Natural Earth`, muted));
      $("map").replaceChildren(svg); current_svg = svg;
      $("summary").textContent = `${routes.length} connections · ${codes.length} airports`;
      $("route-totals").replaceChildren(...totals.map(r => {
        const tr = document.createElement("tr");
        for (const value of [`${r.origin} ↔ ${r.destination}`, r.flights?.toLocaleString() ?? "Not supplied", r.seats?.toLocaleString() ?? "Not supplied", [...r.airlines].join(", ") || "Not supplied"]) {
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
    const url = URL.createObjectURL(svg_blob()); export_busy = true; enable_exports(false);
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = W * 3; canvas.height = H * 3;
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw Error("PNG could not be created. Try the SVG download.");
      download(blob, "altitude-route-map.png"); message("PNG downloaded at 3600 × 2250 pixels.");
    } catch (e) { message(`Export failed: ${e.message}`, true); }
    finally { URL.revokeObjectURL(url); export_busy = false; enable_exports(Boolean(current_svg)); }
  });
  $("controls").addEventListener("submit", e => e.preventDefault());
  $("controls").addEventListener("input", e => { if (e.target.id !== "upload") render(); });
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
      land = await response.json(); await example();
    } catch (e) { message(e.message, true); }
  }
  start();
})();
