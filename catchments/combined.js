// H11 combined catchment map. Saved data only; it never routes in the browser.
(() => {
  const $ = id => document.getElementById(id);
  const COUNTRIES = {
    ie: { name: "Ireland", slug: "ireland", sources: "Sources: CSO Census 2022 population; Tailte Éireann boundaries; OpenRouteService drive times." },
    nz: { name: "New Zealand", slug: "new-zealand", sources: "Sources: legacy New Zealand catchment snapshot; OpenRouteService drive times. Population year and boundary vintage have not been verified." },
    au: { name: "Australia", roads: true, slug: "australia", sources: "Sources: Australian Bureau of Statistics estimated resident population (2025); 2021 statistical area boundaries; OpenRouteService drive times. Country backdrop: Natural Earth." }
  };
  const COLOUR_OPTIONS = [["Navy", "#12243D"], ["Teal", "#0E6B6B"], ["Ochre", "#C8781E"], ["Slate blue", "#6C8EBF"], ["Olive", "#7E8C3A"], ["Mauve", "#9B5C7E"], ["Warm grey", "#8A8781"], ["Gold", "#D9A441"], ["Brick", "#A5473B"], ["Sea green", "#3E9C86"], ["Dark slate", "#4A5566"], ["Sand", "#C9B68F"], ["Plum", "#5E3A5A"], ["Sky", "#9DB9D6"], ["Moss", "#55612A"]];
  const PALETTE = COLOUR_OPTIONS.map(([, colour]) => colour);
  const SEQUENTIAL = ["#E3EFEE", "#A9CFCC", "#5FA19C", "#0E6B6B", "#0A4646"];
  // Population density is shown on a log scale (people vary by thousands of times), purple to yellow.
  const DENSITY = ["#2B0A57", "#6A1B9A", "#B5367A", "#E5604D", "#F7A23B", "#F9E24B"];
  const NEUTRAL = "#EFEDE8";
  const HEAT_BASE = "#F3F1EC";
  const heatCache = new Map();
  const BANDS = [[0, 45, "Under 45 min"], [45, 90, "45 to 90 min"], [90, 150, "90 min to 2.5 hours"], [150, 240, "2.5 to 4 hours"], [240, Infinity, "Over 4 hours"]];
  const SVG_NS = "http://www.w3.org/2000/svg";
  let data, shapes, holeShapes = null, countryLand = [], map, renderer, tiles, land, holes, areas, outlines = [], airports, roads = null, roadLines = [], rows = [], headStartFrame = 0, heatLayers = [], heatPeak = 0, activeCountry = "ie", countryRequest = 0;
  const countryCache = new Map();
  const colourState = { individual: {}, selected: "#0E6B6B", competitors: "#C8781E" };

  const perKm = value => value < 10 ? value.toFixed(1) : people(value);
  const people = value => Math.round(value).toLocaleString("en-NZ");
  const escape = value => String(value ?? "").replace(/[&<>\"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const hex = colour => [1, 3, 5].map(index => parseInt(colour.slice(index, index + 2), 16));
  const mix = (from, to, amount) => "#" + hex(from).map((value, index) => Math.round(value + (hex(to)[index] - value) * amount).toString(16).padStart(2, "0")).join("");
  const ramp = (stops, value) => { const point = Math.max(0, Math.min(1, value)) * (stops.length - 1); const index = Math.min(stops.length - 2, Math.floor(point)); return mix(stops[index], stops[index + 1], point - index); };
  const selected = () => [...document.querySelectorAll("#competitors input:checked")].map(input => input.value);
  const travel = (code, index) => { const road = data.minutes[code]?.[index]; return road != null ? { minutes: road, proxy: false } : { minutes: data.straight_km[code]?.[index], proxy: true }; };
  const airportByCode = code => data.airports.find(airport => airport.code === code);

  function pointInRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function polygonContainsPoint(rings, point) {
    return pointInRing(point, rings[0]) && !rings.slice(1).some(ring => pointInRing(point, ring));
  }

  function containsPoint(feature, point) {
    const { type, coordinates } = feature.geometry;
    return type === "Polygon" ? polygonContainsPoint(coordinates, point) :
      type === "MultiPolygon" && coordinates.some(polygon => polygonContainsPoint(polygon, point));
  }

  async function loadCountry(code) {
    if (!countryCache.has(code)) {
      const files = [`${code}.json`, `${code}.geojson`, ...(code === "au" ? ["../route-map/land.geojson"] : [])];
      const request = Promise.all(files.map(async path => {
        const response = await fetch(path);
        if (!response.ok) throw Error("Data unavailable");
        return response.json();
      })).then(([figures, areas, landData]) => [figures, areas, code === "au" ? landData.features.filter(feature =>
        [[133.775, -25.344], [151.209, -33.869], [115.861, -31.952], [147.327, -42.882], [130.845, -12.463]].some(point => containsPoint(feature, point))
      ) : []]);
      countryCache.set(code, request);
    }
    try { return await countryCache.get(code); }
    catch (error) { countryCache.delete(code); throw error; }
  }

  // No-block shapes are display-only, so fetch them after the catchment map.
  const holesCache = new Map();
  function loadHoles(code) {
    if (!holesCache.has(code)) {
      holesCache.set(code, fetch(`${code}-no-block.geojson`).then(response =>
        response.ok ? response.json() : { type: "FeatureCollection", features: [] }
      ).catch(() => ({ type: "FeatureCollection", features: [] })));
    }
    return holesCache.get(code);
  }

  // Optional road lines between airport pairs, saved as roads-<country>.json by dev/build_catchment_roads.R.
  const roadCache = new Map();
  async function loadRoads(code) {
    if (!COUNTRIES[code].roads) return { pairs: [] };
    if (!roadCache.has(code)) roadCache.set(code, fetch(`roads-${code}.json`).then(response => response.ok ? response.json() : { pairs: [] }).catch(() => ({ pairs: [] })));
    return roadCache.get(code);
  }

  function buildControls() {
    $("focus").replaceChildren(new Option("Country view (all airports)", "all"), ...data.airports.map(airport => new Option(`${airport.name} (${airport.code})`, airport.code)));
    colourState.individual = {};
    data.airports.forEach((airport, index) => { colourState.individual[airport.code] = PALETTE[index % PALETTE.length]; });
    $("competitors").replaceChildren(...data.airports.map(airport => {
      const label = document.createElement("label"); label.className = "check";
      const input = document.createElement("input"); input.type = "checkbox"; input.value = airport.code; input.checked = airport.major;
      label.append(input, ` ${airport.name} (${airport.code})${airport.major ? "" : " — regional"}`); return label;
    }));
    const regions = [...new Set(data.areas.region.filter(Boolean))].sort();
    $("regions-box").hidden = activeCountry !== "au" || !regions.length;
    $("regions-menu").open = false;
    $("regions").replaceChildren(...regions.map(region => {
      const label = document.createElement("label"); label.className = "check";
      const input = document.createElement("input"); input.type = "checkbox"; input.value = region; input.checked = true;
      label.append(input, ` ${region}`); return label;
    }));
    document.querySelector("input[name=airport-colours][value=individual]").checked = true;
    buildColourMenu();
    $("notice").textContent = data.notice;
    roadLines = []; $("roads-field").hidden = true;
    const roadCountry = activeCountry;
    loadRoads(roadCountry).then(file => { if (roadCountry !== activeCountry) return; const lines = file.pairs || []; if (file.source) $("source-note").textContent += ` Road lines: ${file.source}.`; roadLines = lines; $("roads-field").hidden = !lines.length; if (lines.length && map) update(false); });
    $("source-note").textContent = `${COUNTRIES[activeCountry].sources} Where a road time is missing, a straight-line estimate at 60 km/h is used and labelled.`;
    $("intro-copy").textContent = `Explore ${COUNTRIES[activeCountry].name} airport catchments by road. This work-in-progress map uses saved drive times and population data.`;
    $("catchment-result").setAttribute("aria-label", `${COUNTRIES[activeCountry].name} catchment map`);
    document.querySelectorAll(".countries [data-country]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.country === activeCountry)));
  }

  const airportColourMode = () => document.querySelector("input[name=airport-colours]:checked").value;

  function colourControl(label, key, value) {
    const options = COLOUR_OPTIONS.map(([name, colour]) => `<option value="${colour}"${colour === value ? " selected" : ""}>${name}</option>`).join("");
    return `<label class="colour-choice"><span>${escape(label)}</span><select data-colour-key="${key}" aria-label="${escape(label)} colour">${options}</select><i class="colour-swatch" style="background:${value}"></i></label>`;
  }

  function buildColourMenu() {
    const focus = $("focus").value;
    $("colour-options").innerHTML = airportColourMode() === "competing" && focus !== "all"
      ? colourControl(`${focus} (selected airport)`, "selected", colourState.selected) + colourControl("Other airports", "competitors", colourState.competitors)
      : data.airports.map(airport => colourControl(`${airport.name} (${airport.code})`, `individual:${airport.code}`, colourState.individual[airport.code])).join("");
  }

  function syncAirportColours() {
    const countryView = $("focus").value === "all";
    const competing = document.querySelector("input[name=airport-colours][value=competing]");
    competing.disabled = countryView;
    $("competing-colours-label").title = countryView ? "Choose a focus airport to compare colours" : "";
    $("colour-help").textContent = countryView ? "Choose a focus airport to compare it with the other airports." : "Competing colours use one colour for the selected airport and one for all others.";
    if (countryView && airportColourMode() === "competing") {
      document.querySelector("input[name=airport-colours][value=individual]").checked = true;
      buildColourMenu();
    }
  }

  function colourFor(code, result) {
    return airportColourMode() === "competing" && result.focus !== "all" ? (code === result.focus ? colourState.selected : colourState.competitors) : colourState.individual[code];
  }

  function syncCompetitors() {
    const focus = $("focus").value;
    for (const input of document.querySelectorAll("#competitors input")) {
      input.disabled = focus !== "all" && input.value === focus;
      if (input.disabled) input.checked = true;
    }
    const count = selected().length, majorCount = data.airports.filter(airport => airport.major).length;
    $("competitor-summary").textContent = count === majorCount ? `Major airports (${count})` : count === data.airports.length ? `All airports (${count})` : `${count} of ${data.airports.length} airports`;
  }

  // A major airport receives the head start. Equivalently, a regional airport
  // must be more than the selected number of minutes closer to win an area.
  function winner(index, codes, headStart) {
    const usable = codes.map(code => ({ code, ...travel(code, index), major: airportByCode(code).major })).filter(item => item.minutes != null);
    if (!usable.length) return null;
    usable.sort((left, right) => (left.minutes - (left.major ? headStart : 0)) - (right.minutes - (right.major ? headStart : 0)) || (headStart > 0 ? Number(left.major) - Number(right.major) : Number(right.major) - Number(left.major)));
    return usable[0];
  }

  function calculate() {
    const focus = $("focus").value, codes = [...new Set(selected().concat(focus === "all" ? [] : [focus]))];
    const headStart = Number($("head-start").value);
    const regionFilter = $("regions-box").hidden ? null : new Set([...document.querySelectorAll("#regions input:checked")].map(input => input.value));
    rows = data.areas.code.map((code, index) => {
      if (regionFilter && !regionFilter.has(data.areas.region[index])) return null;
      const own = focus === "all" ? null : travel(focus, index);
      const win = winner(index, codes, headStart);
      const adjusted = codes.map(candidate => ({ code: candidate, ...travel(candidate, index), major: airportByCode(candidate).major })).filter(item => item.minutes != null).map(item => ({ ...item, adjusted: item.minutes - (item.major ? headStart : 0) })).sort((a, b) => a.adjusted - b.adjusted);
      let lead = adjusted.length > 1 ? adjusted[1].adjusted - adjusted[0].adjusted : 120;
      if (focus !== "all") {
        const focusTime = adjusted.find(item => item.code === focus)?.adjusted;
        const rivalTime = adjusted.find(item => item.code !== focus)?.adjusted;
        lead = focusTime == null || rivalTime == null ? 120 : (win?.code === focus ? rivalTime - focusTime : focusTime - rivalTime);
      }
      lead = Math.max(0, Math.min(120, lead));
      const included = focus === "all" ? Boolean(win) : win?.code === focus;
      return { index, code, population: data.areas.population[index], density: data.areas.density[index], own, win, lead, included };
    }).filter(Boolean);
    return { focus, codes, headStart };
  }

  function renderTableAndChart(result) {
    const table = $("catchment-table"), chart = $("catchment-chart"), ns = "http://www.w3.org/2000/svg";
    const add = (tag, attrs, parent = chart) => { const element = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value)); parent.append(element); return element; };
    const bandFor = minutes => Math.max(0, BANDS.findIndex(([lower, upper]) => minutes >= lower && minutes < upper));
    const formatMillions = value => `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}m`;
    chart.replaceChildren(); chart.setAttribute("viewBox", "0 0 420 280");
    if (result.focus !== "all") {
      const bandTotals = BANDS.map(() => ({ shown: 0, catchment: 0 }));
      rows.forEach(row => {
        if (row.own?.minutes == null) return;
        const band = bandTotals[bandFor(row.own.minutes)];
        band.shown += row.population;
        if (row.included) band.catchment += row.population;
      });
      let shown = 0, catchment = 0;
      table.innerHTML = `<thead><tr><th>Drive time</th><th>All areas shown</th><th>Cumulative</th><th>Catchment</th><th>Cumulative</th></tr></thead><tbody>` +
        BANDS.map(([lower, upper, label], index) => {
          shown += bandTotals[index].shown; catchment += bandTotals[index].catchment;
          return `<tr><td>${label}</td><td>${people(bandTotals[index].shown)}</td><td>${people(shown)}</td><td>${people(bandTotals[index].catchment)}</td><td>${people(catchment)}</td></tr>`;
        }).join("") + `</tbody><tfoot><tr><td>Total</td><td>${people(shown)}</td><td></td><td>${people(catchment)}</td><td></td></tr></tfoot>`;
      $("data-title").textContent = `Population by drive time to ${airportByCode(result.focus).name}`;
      $("chart-title").textContent = `${airportByCode(result.focus).code} catchment population by drive time`;
      const values = bandTotals.map(band => band.catchment), total = values.reduce((sum, value) => sum + value, 0), max = Math.max(1, total);
      const left = 42, top = 12, plotWidth = 350, plotHeight = 205, rawStep = max / 4, step = rawStep <= 1000000 ? 500000 : 1000000, axisMax = Math.ceil(max / step) * step;
      for (let value = 0; value <= axisMax; value += step) {
        const y = top + plotHeight - plotHeight * value / axisMax;
        add("line", { x1: left, x2: 410, y1: y, y2: y, stroke: value ? "#E6E3DD" : "#C9C5BC", "stroke-width": 1 });
        const label = add("text", { x: left - 6, y: y + 4, "text-anchor": "end", class: "muted" }); label.textContent = formatMillions(value);
      }
      let cumulative = 0;
      const column = plotWidth / (values.length + 1);
      values.forEach((value, index) => {
        const x = left + index * column + column * .16, width = column * .66;
        const y0 = top + plotHeight - plotHeight * cumulative / axisMax; cumulative += value;
        const y1 = top + plotHeight - plotHeight * cumulative / axisMax;
        add("rect", { x, y: y1, width, height: Math.max(1, y0 - y1), rx: 2, fill: colourFor(result.focus, result), "fill-opacity": .78 });
        if (index < values.length - 1) add("line", { x1: x + width, x2: left + (index + 1) * column + column * .16, y1, y2: y1, stroke: "#64676C", "stroke-width": .7, "stroke-dasharray": "2 2" });
        const label = add("text", { x: x + width / 2, y: 232, "text-anchor": "middle", class: "muted" }); label.textContent = ["<45", "45–90", "90–150", "150–240", "240+"][index];
      });
      const totalX = left + values.length * column + column * .16, totalWidth = column * .66, totalY = top + plotHeight - plotHeight * total / axisMax;
      add("rect", { x: totalX, y: totalY, width: totalWidth, height: Math.max(1, top + plotHeight - totalY), rx: 2, fill: colourFor(result.focus, result) });
      const totalLabel = add("text", { x: totalX + totalWidth / 2, y: 232, "text-anchor": "middle", class: "muted" }); totalLabel.textContent = "Total";
      const valueLabel = add("text", { x: totalX + totalWidth / 2, y: totalY - 5, "text-anchor": "middle" }); valueLabel.textContent = formatMillions(total);
      const unit = add("text", { x: left, y: 265, class: "muted" }); unit.textContent = "People by road travel time";
    } else {
      const byAirport = result.codes.map(code => ({ code, bands: BANDS.map(() => 0) }));
      let noRoute = 0;
      const lookup = new Map(byAirport.map(item => [item.code, item]));
      rows.forEach(row => { if (row.win) lookup.get(row.win.code).bands[bandFor(row.win.minutes)] += row.population; else noRoute += row.population; });
      const ordered = byAirport.sort((a, b) => b.bands.reduce((sum, value) => sum + value, 0) - a.bands.reduce((sum, value) => sum + value, 0));
      const routed = ordered.reduce((sum, item) => sum + item.bands.reduce((sub, value) => sub + value, 0), 0);
      const shares = ordered.map(item => {
        const total = item.bands.reduce((sum, value) => sum + value, 0), tenths = routed ? 1000 * total / routed : 0;
        return { tenths: Math.floor(tenths), remainder: tenths - Math.floor(tenths) };
      });
      const extraTenths = routed ? 1000 - shares.reduce((sum, share) => sum + share.tenths, 0) : 0;
      [...shares.keys()].sort((left, right) => shares[right].remainder - shares[left].remainder).slice(0, extraTenths).forEach(index => shares[index].tenths++);
      table.innerHTML = `<thead><tr><th>Airport</th>${BANDS.map(([, , label]) => `<th>${label}</th>`).join("")}<th>Catchment</th><th>Share</th></tr></thead><tbody>` +
        ordered.map((item, index) => { const total = item.bands.reduce((sum, value) => sum + value, 0); return `<tr><td>${airportByCode(item.code).name} (${item.code})</td>${item.bands.map(value => `<td>${people(value)}</td>`).join("")}<td>${people(total)}</td><td>${(shares[index].tenths / 10).toFixed(1)}%</td></tr>`; }).join("") +
        (noRoute ? `<tr><td>No route</td>${BANDS.map(() => `<td>—</td>`).join("")}<td>${people(noRoute)}</td><td>—</td></tr>` : "") +
        `</tbody><tfoot><tr><td>Total</td>${BANDS.map((_, index) => `<td>${people(ordered.reduce((sum, item) => sum + item.bands[index], 0))}</td>`).join("")}<td>${people(routed + noRoute)}</td><td>${noRoute ? "—" : "100%"}</td></tr></tfoot>`;
      $("data-title").textContent = "Catchment by airport and drive time";
      $("chart-title").textContent = "People closer to each airport";
      const totals = ordered.map(item => ({ code: item.code, total: item.bands.reduce((sum, value) => sum + value, 0) }));
      const maximum = Math.max(1, ...totals.map(item => item.total)), left = 62, right = 48, top = 12, rowHeight = Math.max(25, Math.min(42, 840 / totals.length)), plotWidth = 410 - left - right;
      chart.setAttribute("viewBox", `0 0 420 ${top + totals.length * rowHeight + 30}`);
      totals.forEach((item, index) => {
        const y = top + index * rowHeight, width = plotWidth * item.total / maximum;
        const name = add("text", { x: left - 8, y: y + 20, "text-anchor": "end" }); name.textContent = item.code;
        add("rect", { x: left, y: y + 6, width: Math.max(width, 1), height: 24, rx: 2, fill: colourFor(item.code, result) });
        const value = add("text", { x: Math.min(405, left + width + 6), y: y + 22 }); value.textContent = formatMillions(item.total);
      });
    }
  }

  // Position (0 to 1) of a density on a log scale between the sparsest and densest areas shown.
  function densityScale(values) {
    const sorted = values.filter(value => value > 0).sort((a, b) => a - b);
    const pick = share => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 1;
    const low = Math.max(pick(.03), .1), high = Math.max(pick(.995), low * 10);
    const span = Math.log10(high) - Math.log10(low);
    return { low, high, at: value => value > 0 ? Math.max(0, Math.min(1, (Math.log10(value) - Math.log10(low)) / span)) : 0 };
  }

  // Population heat: people per km² smoothed with a Gaussian kernel, drawn as stacked vector contours.
  function heatSurface(layer) {
    const key = activeCountry;
    if (heatCache.has(key)) return heatCache.get(key);
    const points = [];
    layer.eachLayer(item => {
      const index = item.feature?.properties?.i, population = data.areas.population[index], centre = item.getBounds().getCenter();
      if (population > 0 && Number.isFinite(centre.lat)) points.push({ lat: centre.lat, lng: centre.lng, population });
    });
    const box = mainlandBounds(layer), midLat = (box.getNorth() + box.getSouth()) / 2, kmLat = 111.2, kmLng = 111.2 * Math.cos(midLat * Math.PI / 180);
    const columns = 200, cellKm = (box.getEast() - box.getWest()) * kmLng / columns, sigma = Math.max(12, 2.2 * cellKm);
    const dx = cellKm / kmLng, dy = cellKm / kmLat, pad = Math.ceil(3 * sigma / cellKm) + 1;
    const west = box.getWest() - pad * dx, north = box.getNorth() + pad * dy;
    const nx = columns + 2 * pad, ny = Math.ceil((box.getNorth() - box.getSouth()) / dy) + 2 * pad;
    const grid = Array.from({ length: ny }, () => new Float64Array(nx)), reach = Math.ceil(3 * sigma / cellKm), norm = 1 / (2 * Math.PI * sigma * sigma);
    for (const point of points) {
      const cx = (point.lng - west) / dx, cy = (north - point.lat) / dy;
      for (let j = Math.max(0, Math.floor(cy) - reach); j <= Math.min(ny - 1, Math.ceil(cy) + reach); j++) {
        for (let i = Math.max(0, Math.floor(cx) - reach); i <= Math.min(nx - 1, Math.ceil(cx) + reach); i++) {
          const km2 = ((i - cx) ** 2 + (j - cy) ** 2) * cellKm * cellKm;
          grid[j][i] += point.population * norm * Math.exp(-km2 / (2 * sigma * sigma));
        }
      }
    }
    let peak = 0; grid.forEach(row => row.forEach(value => { if (value > peak) peak = value; }));
    const levels = [];
    for (let step = 8; step >= 1; step--) { const level = peak * Math.pow(.6, step); if (level >= 4) levels.push(level); }
    const result = { peak, sigma, levels: levels.map(level => ({ level, rings: contourRings(grid, level, west, north, dx, dy) })) };
    heatCache.set(key, result);
    return result;
  }

  // Marching squares: closed rings (lat/lng) around the region where the surface is at or above the level.
  function contourRings(grid, level, west, north, dx, dy) {
    const ny = grid.length, nx = grid[0].length, segments = [], ends = new Map();
    const point = (kind, i, j, a, b) => {
      const fraction = (level - a) / (b - a);
      return kind === "h" ? [north - j * dy, west + (i + fraction) * dx] : [north - (j + fraction) * dy, west + i * dx];
    };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
      const code = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const edges = {
        top: ["h" + i + "," + j, () => point("h", i, j, a, b)], right: ["v" + (i + 1) + "," + j, () => point("v", i + 1, j, b, c)],
        bottom: ["h" + i + "," + (j + 1), () => point("h", i, j + 1, d, c)], left: ["v" + i + "," + j, () => point("v", i, j, a, d)]
      };
      const centre = (a + b + c + d) / 4 >= level;
      const pairs = { 1: [["left", "bottom"]], 2: [["bottom", "right"]], 3: [["left", "right"]], 4: [["top", "right"]],
        5: centre ? [["top", "left"], ["bottom", "right"]] : [["top", "right"], ["left", "bottom"]], 6: [["top", "bottom"]], 7: [["top", "left"]],
        8: [["top", "left"]], 9: [["top", "bottom"]], 10: centre ? [["top", "right"], ["left", "bottom"]] : [["top", "left"], ["bottom", "right"]],
        11: [["top", "right"]], 12: [["left", "right"]], 13: [["bottom", "right"]], 14: [["left", "bottom"]] }[code];
      for (const [from, to] of pairs) {
        const segment = { from: edges[from][0], to: edges[to][0], a: edges[from][1], b: edges[to][1], used: false };
        segments.push(segment);
        for (const keyName of [segment.from, segment.to]) { if (!ends.has(keyName)) ends.set(keyName, []); ends.get(keyName).push(segment); }
      }
    }
    const rings = [];
    for (const start of segments) {
      if (start.used) continue;
      start.used = true;
      const ring = [start.a(), start.b()]; let tail = start.to;
      for (;;) {
        const next = (ends.get(tail) || []).find(segment => !segment.used);
        if (!next) break;
        next.used = true;
        if (next.from === tail) { ring.push(next.b()); tail = next.to; } else { ring.push(next.a()); tail = next.from; }
      }
      if (ring.length > 3) rings.push(ring);
    }
    return rings;
  }

  function drawHeat(layer) {
    heatLayers.forEach(item => item.remove()); heatLayers = [];
    const surface = heatSurface(layer), count = surface.levels.length;
    surface.levels.forEach((item, index) => {
      heatLayers.push(L.polygon(item.rings, { renderer, interactive: false, stroke: true, weight: .8, color: mix("#0A4646", "#FAFAF8", .55),
        fillColor: ramp(SEQUENTIAL, .12 + .88 * (index + 1) / count), fillOpacity: .9, fillRule: "evenodd" }).addTo(map));
    });
    return surface;
  }

  function style(result) {
    const mode = document.querySelector("input[name=colour]:checked").value;
    const density = mode === "density", heat = mode === "heat";
    const values = rows.map(row => row.density).filter(Number.isFinite);
    const low = Math.min(...values), high = Math.max(...values);
    const scaled = density ? densityScale(values) : null;
    const colour = row => {
      if (heat) return HEAT_BASE;
      if (density) return ramp(DENSITY, scaled.at(row.density));
      const base = colourFor(row.win?.code, result);
      return row.win ? mix(NEUTRAL, base, .28 + .72 * Math.min(1, row.lead / 120)) : NEUTRAL;
    };
    return { density, heat, colour, low: scaled?.low ?? low, high: scaled?.high ?? high };
  }

  function popup(row, result) {
    const own = row.own?.minutes == null ? "No route" : `${Math.round(row.own.minutes)} min${row.own.proxy ? " (straight-line estimate)" : " by road"}`;
    return `<strong>${escape(data.areas.name[row.index])}</strong><br>Population: ${people(row.population)}<br>` +
      (result.focus === "all" ? `Closest airport: ${escape(row.win?.code ?? "None")}` : `${escape(result.focus)}: ${own}`) +
      (row.win ? `<br>Catchment winner: ${escape(row.win.code)}` : "");
  }

  function draw(result, scale, fit) {
    const rowByIndex = new Map(rows.map(row => [row.index, row]));
    land?.remove();
    land = countryLand.length ? L.geoJSON({ type: "FeatureCollection", features: countryLand }, { renderer, interactive: false,
      style: { className: "country-background", color: "#DCD6CB", weight: .5, fillColor: "#F1EFEA", fillOpacity: 1 }
    }).addTo(map) : null;
    holes?.remove();
    holes = holeShapes?.features.length ? L.geoJSON(holeShapes, {
      renderer, interactive: false,
      style: { color: "#E9E7E2", weight: 0, fillColor: "#E9E7E2", fillOpacity: 1 }
    }).addTo(map) : null;
    areas?.remove();
    areas = L.geoJSON(shapes, { renderer, filter: feature => rowByIndex.has(feature.properties.i), style: feature => {
      const row = rowByIndex.get(feature.properties.i), fillColor = scale.colour(row);
      const streetMap = $("street-map").checked, blockBorders = $("block-borders").checked;
      // A same-colour opaque outline overlaps neighbouring fills by one pixel,
      // preventing SVG anti-aliasing seams in the clean vector view. It is not
      // used over translucent street-map fills, where overlaps would look dark.
      return blockBorders ? { fillColor, fillOpacity: streetMap ? .76 : 1, color: "#FAFAF8", weight: .5, opacity: 1 } :
        streetMap ? { fillColor, fillOpacity: .76, stroke: false } :
          { fillColor, fillOpacity: 1, color: fillColor, weight: 1, opacity: 1 };
    }, onEachFeature: (feature, layer) => layer.bindPopup(() => popup(rowByIndex.get(feature.properties.i), result)) }).addTo(map);
    heatPeak = scale.heat ? drawHeat(areas).peak : (heatLayers.forEach(item => item.remove()), heatLayers = [], 0);
    outlines.forEach(outline => outline.remove()); outlines = [];
    if ($("catchment-outline").checked) {
      const groups = result.focus === "all" ? [...new Set(rows.filter(row => row.win).map(row => row.win.code))].map(code => ({ code, indices: rows.filter(row => row.win?.code === code).map(row => row.index) })) : [{ code: result.focus, indices: rows.filter(row => row.included).map(row => row.index) }];
      outlines = groups.map(group => L.geoJSON(CatchmentOutline.merge(data.outlines.features, new Set(group.indices)), { renderer, interactive: false, style: { color: result.focus === "all" ? colourFor(group.code, result) : "#222326", weight: 1.8, fill: false } }).addTo(map));
    }
    roads?.remove(); roads = null;
    const shownRoads = $("roads-on").checked ? roadLines.filter(line => result.codes.includes(line.from) && result.codes.includes(line.to)) : [];
    if (shownRoads.length) roads = L.layerGroup(shownRoads.flatMap(line => [
      L.polyline(line.coordinates.map(([lng, lat]) => [lat, lng]), { renderer, interactive: false, color: "#FAFAF8", weight: 4.6, opacity: .9, lineCap: "round", lineJoin: "round" }),
      L.polyline(line.coordinates.map(([lng, lat]) => [lat, lng]), { renderer, interactive: false, color: "#222326", weight: 2.4, dashArray: "8 6", lineCap: "butt", lineJoin: "round" })
    ])).addTo(map);
    airports?.remove();
    airports = L.layerGroup(result.codes.map(code => {
      const airport = airportByCode(code), selectedAirport = code === result.focus;
      return L.circleMarker([airport.lat, airport.lon], { renderer, radius: selectedAirport ? 7 : 5.5, color: "#222326", weight: 2.2, fillColor: "#FFFFFF", fillOpacity: 1 })
        .bindTooltip(airport.code, { permanent: true, direction: "top", className: "airport-label", offset: [0, -5] });
    })).addTo(map);
    if (fit) map.fitBounds(countryLand.length ? land.getBounds() : mainlandBounds(areas), { padding: [18, 18] });
  }

  // Remote islands (for example the Chatham Islands) would zoom the map out to the whole Pacific,
  // so fit to the areas whose centres sit inside the middle 99% of the country.
  function mainlandBounds(layer) {
    const items = [];
    layer.eachLayer(item => { const bounds = item.getBounds(); if (bounds.isValid()) items.push({ bounds, centre: bounds.getCenter() }); });
    if (items.length < 50) return layer.getBounds();
    const range = key => { const values = items.map(item => item.centre[key]).sort((a, b) => a - b); return [values[Math.floor(values.length * .005)], values[Math.ceil(values.length * .995) - 1]]; };
    const [south, north] = range("lat"), [west, east] = range("lng"), result = L.latLngBounds([]);
    items.filter(item => item.centre.lat >= south && item.centre.lat <= north && item.centre.lng >= west && item.centre.lng <= east).forEach(item => result.extend(item.bounds));
    return result.isValid() ? result : layer.getBounds();
  }

  function labels(result, scale) {
    const focusAirport = result.focus === "all" ? null : airportByCode(result.focus);
    $("map-title").textContent = focusAirport ? `${focusAirport.name}: where it is closest by road` : `${COUNTRIES[activeCountry].name}: closest airport by road`;
    $("map-subtitle").textContent = focusAirport ? `Compared with the selected airports${result.headStart ? `, with a ${result.headStart}-minute head start for major airports` : ""}.` : `Each area is assigned to the closest selected airport${result.headStart ? `, with a ${result.headStart}-minute head start for major airports` : ""}.`;
    const proxies = rows.filter(row => row.own?.proxy || row.win?.proxy).length;
    if (focusAirport) {
      const inside = rows.filter(row => row.included).reduce((sum, row) => sum + row.population, 0), total = rows.reduce((sum, row) => sum + row.population, 0);
      $("summary").innerHTML = `<strong>${people(inside)}</strong> people live in ${escape(focusAirport.name)}’s catchment, out of ${people(total)} in the areas shown.${proxies ? ` ${proxies} areas use a straight-line estimate.` : ""}`;
    } else {
      const totals = result.codes.map(code => [code, rows.filter(row => row.win?.code === code).reduce((sum, row) => sum + row.population, 0)]).sort((a, b) => b[1] - a[1]);
      $("summary").innerHTML = totals.map(([code, total]) => `<strong>${code}</strong> ${people(total)}`).join(" · ") + " people in each catchment.";
    }
    const noBlockKey = holeShapes?.features.length ? '<span class="no-block"><i></i>No catchment block</span>' : "";
    if (scale.heat) {
      $("legend").innerHTML = `<span>Fewer people</span><span class="ramp" style="background:linear-gradient(90deg, ${SEQUENTIAL.join(",")})"></span><span>${people(Math.round(heatPeak / 10) * 10)} people per km² at the peak (smoothed)</span>${noBlockKey}`;
    } else if (scale.density) {
      $("legend").innerHTML = `<span>${perKm(scale.low)}</span><span class="ramp" style="background:linear-gradient(90deg, ${DENSITY.join(",")})"></span><span>${perKm(scale.high)} people per km² (log scale)</span>${noBlockKey}`;
    } else {
      const chips = airportColourMode() === "competing" && result.focus !== "all"
        ? `<span><i style="background:${colourState.selected}"></i>${result.focus} (selected)</span><span><i style="background:${colourState.competitors}"></i>Other airports</span>`
        : result.codes.map(code => `<span><i style="background:${colourFor(code, result)}"></i>${code}</span>`).join("");
      const rampColour = result.focus === "all" ? "#64676C" : colourFor(result.focus, result);
      $("legend").innerHTML = `<span>${result.focus === "all" ? "Marginal" : "Less decisive"}</span><span class="ramp" style="background:linear-gradient(90deg, ${NEUTRAL}, ${rampColour})"></span><span>${result.focus === "all" ? "Clear lead" : "More decisive"}</span>${noBlockKey}${chips}${$("catchment-outline").checked ? '<span class="outline"></span><span>Catchment outline</span>' : ""}`;
    }
    if (roads) $("legend").insertAdjacentHTML("beforeend", '<span class="road-key"></span><span>Road between airports</span>');
  }

  function addExportText(parent, text, x, y, size, weight = 400) {
    const element = document.createElementNS(SVG_NS, "text");
    element.setAttribute("x", x); element.setAttribute("y", y);
    element.setAttribute("font-family", "Inter, Arial, sans-serif");
    element.setAttribute("font-size", size); element.setAttribute("font-weight", weight);
    element.setAttribute("fill", "#222326"); element.textContent = text;
    parent.append(element);
    return element;
  }

  function addWrappedExportText(parent, text, x, y, size, maxCharacters) {
    const lines = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxCharacters && line) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    const element = addExportText(parent, lines[0] || "", x, y, size);
    lines.slice(1).forEach((part, index) => {
      const span = document.createElementNS(SVG_NS, "tspan"); span.setAttribute("x", x); span.setAttribute("dy", size * 1.35); span.textContent = part; element.append(span);
    });
  }

  function addExportLegend(svg, top, width) {
    const children = [...$("legend").children];
    const rampLabelIndices = new Set(children.flatMap((item, index) => item.classList.contains("ramp") ? [index - 1, index + 1] : []));
    const legendHeight = 22, gap = 13;
    let x = 24, y = top;
    const place = itemWidth => {
      if (x + itemWidth > width - 24 && x > 24) { x = 24; y += legendHeight + 8; }
      const position = { x, y };
      x += itemWidth + gap;
      return position;
    };
    const addLegendText = (text, tx, ty) => {
      const element = addExportText(svg, text, tx, ty, 13);
      element.setAttribute("fill", "#64676C");
      return element;
    };

    children.forEach((item, index) => {
      const rampElement = item.classList.contains("ramp") ? item : item.querySelector(".ramp");
      if (rampElement) {
        const before = item.classList.contains("ramp") ? children[index - 1]?.textContent.trim() : "";
        const after = item.classList.contains("ramp") ? children[index + 1]?.textContent.trim() : "";
        const colors = getComputedStyle(rampElement).backgroundImage.match(/#[\da-f]{3,8}|rgba?\([^)]+\)/gi) || [];
        const rampWidth = 220, itemWidth = Math.max(120, before.length * 7 + after.length * 7 + rampWidth + 34);
        const position = place(itemWidth);
        addLegendText(before, position.x, position.y + 13);
        const barX = position.x + before.length * 7 + 8, barY = position.y + 2;
        const gradient = document.createElementNS(SVG_NS, "linearGradient");
        const gradientId = `export-legend-gradient-${index}`;
        gradient.setAttribute("id", gradientId); gradient.setAttribute("x1", "0%"); gradient.setAttribute("x2", "100%");
        colors.forEach((color, stopIndex) => {
          const stop = document.createElementNS(SVG_NS, "stop");
          stop.setAttribute("offset", `${stopIndex / Math.max(1, colors.length - 1) * 100}%`); stop.setAttribute("stop-color", color); gradient.append(stop);
        });
        const defs = svg.querySelector("defs");
        defs.append(gradient);
        const bar = document.createElementNS(SVG_NS, "rect");
        bar.setAttribute("x", barX); bar.setAttribute("y", barY); bar.setAttribute("width", rampWidth); bar.setAttribute("height", 10);
        bar.setAttribute("fill", `url(#${gradientId})`); bar.setAttribute("stroke", "#DCD6CB"); bar.setAttribute("data-export-legend", "ramp"); svg.append(bar);
        addLegendText(after, barX + rampWidth + 8, position.y + 13);
        return;
      }

      if (rampLabelIndices.has(index)) return;
      const swatch = item.querySelector("i");
      const text = item.textContent.trim();
      if (swatch) {
        const labelWidth = text.length * 7 + 20, position = place(labelWidth);
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", position.x); rect.setAttribute("y", position.y + 1); rect.setAttribute("width", 11); rect.setAttribute("height", 11);
        rect.setAttribute("rx", 2); rect.setAttribute("fill", getComputedStyle(swatch).backgroundColor); rect.setAttribute("data-export-legend", "airport"); svg.append(rect);
        addLegendText(text, position.x + 16, position.y + 12);
      } else if (item.classList.contains("outline")) {
        const position = place(28), rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", position.x); rect.setAttribute("y", position.y + 1); rect.setAttribute("width", 14); rect.setAttribute("height", 10);
        rect.setAttribute("fill", "none"); rect.setAttribute("stroke", "#222326"); rect.setAttribute("stroke-width", "2"); rect.setAttribute("data-export-legend", "outline"); svg.append(rect);
      } else if (text && !item.classList.contains("ramp")) {
        const position = place(text.length * 7 + 4);
        addLegendText(text, position.x, position.y + 13);
      }
    });
    return y + legendHeight;
  }

  function createExportSvg(includeTiles = false) {
    const mapRect = map.getContainer().getBoundingClientRect();
    const width = Math.max(1200, mapRect.width), scale = width / mapRect.width;
    const mapOnly = $("export-map-only").checked;
    const headerHeight = mapOnly ? 0 : 82, mapHeight = mapRect.height * scale, footerHeight = mapOnly ? 0 : 185;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("xmlns", SVG_NS); svg.setAttribute("width", width); svg.setAttribute("height", headerHeight + mapHeight + footerHeight);
    svg.setAttribute("viewBox", `0 0 ${width} ${headerHeight + mapHeight + footerHeight}`);
    const title = document.createElementNS(SVG_NS, "title"); title.textContent = $("map-title").textContent; svg.append(title);
    const page = document.createElementNS(SVG_NS, "rect");
    page.setAttribute("width", width); page.setAttribute("height", headerHeight + mapHeight + footerHeight); page.setAttribute("fill", "#FAFAF8");
    svg.append(page);
    if (!includeTiles) {
      const mapBackground = document.createElementNS(SVG_NS, "rect");
      mapBackground.setAttribute("y", headerHeight); mapBackground.setAttribute("width", width); mapBackground.setAttribute("height", mapHeight); mapBackground.setAttribute("fill", "#FAFAF8");
      svg.append(mapBackground);
    } else {
      page.remove();
      const header = document.createElementNS(SVG_NS, "rect");
      header.setAttribute("width", width); header.setAttribute("height", headerHeight); header.setAttribute("fill", "#FAFAF8"); svg.append(header);
      const footer = document.createElementNS(SVG_NS, "rect");
      footer.setAttribute("y", headerHeight + mapHeight); footer.setAttribute("width", width); footer.setAttribute("height", footerHeight); footer.setAttribute("fill", "#FAFAF8"); svg.append(footer);
    }
    if (!mapOnly) {
      addExportText(svg, $("map-title").textContent, 24, 34, 25, 600);
      addExportText(svg, $("map-subtitle").textContent, 24, 59, 15);
    }
    const vector = map.getContainer().querySelector(".leaflet-overlay-pane svg");
    if (!vector) throw Error("The map is not ready to export.");
    const vectorRect = vector.getBoundingClientRect(), defs = document.createElementNS(SVG_NS, "defs"), clip = document.createElementNS(SVG_NS, "clipPath"), clipRect = document.createElementNS(SVG_NS, "rect"), mapGroup = document.createElementNS(SVG_NS, "g");
    clip.setAttribute("id", "export-map-clip"); clipRect.setAttribute("y", headerHeight); clipRect.setAttribute("width", width); clipRect.setAttribute("height", mapHeight); clip.append(clipRect); defs.append(clip); svg.append(defs);
    mapGroup.setAttribute("clip-path", "url(#export-map-clip)"); svg.append(mapGroup);
    const overlay = vector.cloneNode(true);
    overlay.setAttribute("x", (vectorRect.left - mapRect.left) * scale); overlay.setAttribute("y", headerHeight + (vectorRect.top - mapRect.top) * scale);
    overlay.setAttribute("width", vectorRect.width * scale); overlay.setAttribute("height", vectorRect.height * scale); overlay.removeAttribute("style");
    mapGroup.append(overlay);
    for (const tooltip of map.getContainer().querySelectorAll(".leaflet-tooltip-pane .leaflet-tooltip")) {
      const rect = tooltip.getBoundingClientRect();
      const label = addExportText(mapGroup, tooltip.textContent.trim(), (rect.left + rect.width / 2 - mapRect.left) * scale, headerHeight + (rect.bottom - mapRect.top) * scale, 12 * scale, 600);
      label.setAttribute("text-anchor", "middle"); label.setAttribute("stroke", "#FAFAF8"); label.setAttribute("stroke-width", 3 * scale); label.setAttribute("paint-order", "stroke");
    }
    if (!mapOnly) {
      const legendBottom = addExportLegend(svg, headerHeight + mapHeight + 27, width);
      const source = [...document.querySelectorAll("footer p")].map(paragraph => paragraph.innerText.trim()).filter(Boolean).join(" ") + (includeTiles ? " Street map: © OpenStreetMap contributors." : "");
      addWrappedExportText(svg, source, 24, legendBottom + 18, 11, 190);
    }
    return { svg, width, height: headerHeight + mapHeight + footerHeight, headerHeight, mapHeight, mapRect, scale };
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement("a"), url = URL.createObjectURL(blob);
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadSvg() {
    try {
      const { svg } = createExportSvg(false), xml = new XMLSerializer().serializeToString(svg);
      downloadBlob(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }), exportName("svg"));
      $("export-status").textContent = "SVG downloaded.";
    } catch (error) { $("export-status").textContent = "The SVG could not be created. Please try again."; }
  }

  function exportName(extension) {
    const airport = $("focus").value === "all" ? "country" : $("focus").value.toLowerCase();
    return `${COUNTRIES[activeCountry].slug}-catchment-${airport}.${extension}`;
  }

  function syncExportControls() {
    const streetMap = $("street-map").checked;
    $("export-svg").disabled = !map || streetMap;
    $("export-png").disabled = !map;
    $("export-svg").title = streetMap ? "Turn off the street map to download SVG." : "Download the vector map as SVG.";
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      try { canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("The browser could not create a PNG.")), "image/png"); }
      catch (error) { reject(error); }
    });
  }

  function loadImage(src, crossOrigin = false) {
    return new Promise((resolve, reject) => {
      const image = new Image(), timeout = setTimeout(() => reject(Error("An image took too long to load.")), 10000);
      try { if (crossOrigin) image.crossOrigin = "anonymous"; }
      catch (error) { clearTimeout(timeout); reject(error); return; }
      image.onload = () => { clearTimeout(timeout); resolve(image); };
      image.onerror = () => { clearTimeout(timeout); reject(Error("An image could not be included in the PNG.")); };
      image.src = src;
    });
  }

  async function visibleStreetTiles() {
    if (tiles.isLoading()) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error("Street-map tiles took too long to load.")), 10000);
        tiles.once("load", () => { clearTimeout(timeout); resolve(); });
      });
    }
    const bounds = map.getContainer().getBoundingClientRect();
    const visible = [...map.getContainer().querySelectorAll(".leaflet-tile")].filter(tile => {
      const rect = tile.getBoundingClientRect();
      return rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    const loaded = visible.filter(tile => tile.classList.contains("leaflet-tile-loaded") && tile.naturalWidth > 0);
    if (!loaded.length || loaded.length !== visible.length) throw Error("The street-map tiles are not all available.");
    return loaded;
  }

  async function createPng(includeTiles) {
    const snapshot = createExportSvg(includeTiles), xml = new XMLSerializer().serializeToString(snapshot.svg);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" }), svgUrl = URL.createObjectURL(svgBlob);
    try {
      const svgImage = await loadImage(svgUrl), outputScale = 1600 / snapshot.width;
      const canvas = document.createElement("canvas");
      canvas.width = 1600; canvas.height = Math.ceil(snapshot.height * outputScale);
      const context = canvas.getContext("2d");
      context.fillStyle = "#FAFAF8"; context.fillRect(0, 0, canvas.width, canvas.height);
      if (includeTiles) {
        const tiles = (await visibleStreetTiles()).map(tile => ({
          src: tile.currentSrc || tile.src, rect: tile.getBoundingClientRect(), opacity: Number(getComputedStyle(tile).opacity)
        })).filter(tile => tile.rect.right > snapshot.mapRect.left && tile.rect.left < snapshot.mapRect.right && tile.rect.bottom > snapshot.mapRect.top && tile.rect.top < snapshot.mapRect.bottom);
        if (!tiles.length) throw Error("No street-map tiles are available.");
        const images = await Promise.all(tiles.map(tile => loadImage(tile.src, true)));
        context.save(); context.beginPath();
        context.rect(0, snapshot.headerHeight * outputScale, canvas.width, snapshot.mapHeight * outputScale); context.clip();
        tiles.forEach((tile, index) => {
          context.globalAlpha = tile.opacity;
          const tileScale = snapshot.scale * outputScale;
          context.drawImage(images[index], (tile.rect.left - snapshot.mapRect.left) * tileScale, (snapshot.headerHeight + (tile.rect.top - snapshot.mapRect.top) * snapshot.scale) * outputScale, tile.rect.width * tileScale, tile.rect.height * tileScale);
        });
        context.restore();
      }
      context.drawImage(svgImage, 0, 0, canvas.width, canvas.height);
      return await canvasBlob(canvas);
    } finally { URL.revokeObjectURL(svgUrl); }
  }

  async function downloadPng() {
    const includeTiles = $("street-map").checked;
    try {
      const blob = await createPng(includeTiles);
      downloadBlob(blob, exportName("png"));
      $("export-status").textContent = includeTiles ? "PNG downloaded with the street map." : "PNG downloaded.";
    } catch (error) {
      if (!includeTiles) {
        $("export-status").textContent = "The PNG could not be created. Please try again.";
        return;
      }
      try {
        const blob = await createPng(false);
        downloadBlob(blob, exportName("png"));
        $("export-status").textContent = "Street map tiles could not be included. Downloaded the map without them.";
      } catch (fallbackError) {
        $("export-status").textContent = "The PNG could not be created. Please try again.";
      }
    }
  }

  function syncRegions() {
    const boxes = [...document.querySelectorAll("#regions input")], count = boxes.filter(input => input.checked).length;
    $("regions-summary").textContent = count === boxes.length ? `All states (${count})` : `${count} of ${boxes.length} states`;
  }

  function update(fit = false) { if (!data) return; syncRegions(); syncCompetitors(); syncAirportColours(); const result = calculate(), scale = style(result); draw(result, scale, fit); labels(result, scale); renderTableAndChart(result); }

  async function switchCountry(code) {
    if (!COUNTRIES[code] || code === activeCountry) return;
    const request = ++countryRequest;
    document.querySelectorAll(".countries [data-country]").forEach(button => { button.disabled = true; });
    $("map-subtitle").textContent = `Loading saved ${COUNTRIES[code].name} catchment data…`;
    try {
      const [nextData, nextShapes, nextLand] = await loadCountry(code);
      if (request !== countryRequest) return;
      activeCountry = code; data = nextData; shapes = nextShapes; holeShapes = null; countryLand = nextLand;
      buildControls(); update(true); syncExportControls();
      loadHoles(code).then(nextHoles => {
        if (code !== activeCountry) return;
        holeShapes = nextHoles; update(false);
      });
    } catch (error) {
      if (request === countryRequest) {
        $("map-subtitle").textContent = `The saved ${COUNTRIES[code].name} data could not be loaded. Please try again later.`;
        document.querySelectorAll(".countries [data-country]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.country === activeCountry)));
      }
    } finally {
      document.querySelectorAll(".countries [data-country]").forEach(button => { button.disabled = false; });
    }
  }

  async function start() {
    try {
      [data, shapes, countryLand] = await loadCountry(activeCountry);
    } catch (error) { $("map-subtitle").textContent = "The saved Ireland data could not be loaded. Please try again later."; return; }
    buildControls(); $("notice").textContent = data.notice;
    renderer = L.svg(); map = L.map("map", { renderer, scrollWheelZoom: true });
    tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap contributors" });
    update(true);
    const initialCountry = activeCountry;
    loadHoles(initialCountry).then(nextHoles => {
      if (initialCountry !== activeCountry) return;
      holeShapes = nextHoles; update(false);
    });
    syncExportControls();
    $("export-svg").addEventListener("click", downloadSvg);
    $("export-png").addEventListener("click", downloadPng);
    document.querySelectorAll(".countries [data-country]").forEach(button => button.addEventListener("click", () => switchCountry(button.dataset.country)));
    $("focus").addEventListener("change", () => { syncAirportColours(); buildColourMenu(); update(false); });
    $("competitors").addEventListener("change", () => update(false));
    $("select-all").addEventListener("click", () => { document.querySelectorAll("#competitors input").forEach(input => input.checked = true); update(false); });
    $("select-major").addEventListener("click", () => { document.querySelectorAll("#competitors input").forEach(input => input.checked = airportByCode(input.value).major); update(false); });
    $("regions").addEventListener("change", () => update(true));
    document.querySelectorAll("input[name=colour]").forEach(input => input.addEventListener("change", () => update(false)));
    document.querySelectorAll("input[name=airport-colours]").forEach(input => input.addEventListener("change", () => { buildColourMenu(); update(false); }));
    $("colour-options").addEventListener("change", event => {
      const key = event.target.dataset.colourKey;
      if (!key) return;
      if (key.startsWith("individual:")) colourState.individual[key.slice("individual:".length)] = event.target.value;
      else colourState[key] = event.target.value;
      event.target.nextElementSibling.style.background = event.target.value;
      update(false);
    });
    $("head-start").addEventListener("input", event => { $("head-start").nextElementSibling.value = `${event.target.value} min`; cancelAnimationFrame(headStartFrame); headStartFrame = requestAnimationFrame(() => update(false)); });
    $("head-start").addEventListener("change", () => { cancelAnimationFrame(headStartFrame); update(false); });
    for (const id of ["block-borders", "catchment-outline", "roads-on"]) $(id).addEventListener("change", () => update(false));
    $("street-map").addEventListener("change", event => { event.target.checked ? tiles.addTo(map) : tiles.remove(); $("street-label").textContent = event.target.checked ? "On: street map behind" : "Off: clean vector view"; syncExportControls(); update(false); });
    document.addEventListener("click", event => { for (const id of ["competitor-menu", "regions-menu"]) { const menu = $(id); if (menu.open && !menu.contains(event.target)) menu.open = false; } });
  }
  window.addEventListener("DOMContentLoaded", start);
})();
