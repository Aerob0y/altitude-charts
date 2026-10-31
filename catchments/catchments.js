// Airport catchments (Beta). Figures come from <country>.json and shapes from <country>.geojson,
// both written by catchment_write_site_data() in app/utils/data/catchment_snapshots.r.
// Mirrors catchment_compare(): road minutes where routed, else straight-line km at 60 km/h.
(() => {
  const $ = id => document.getElementById(id);
  const BANDS = [0, 45, 90, 150, 240, Infinity];
  const DEFAULT_AIRPORT = { nz: "ZQN", au: "CBR", ie: "ORK" };
  const DENSITY = ["#ffffd9", "#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#0c2c84"];
  // STYLE.md diverging scale: ochre where a rival is closer, teal where this airport is.
  // Capped at 120 minutes to match the access bands on the airport map images.
  const SAVING = ["#C8781E", "#E4B984", "#EFEDE8", "#7FB5B0", "#0E6B6B"];
  const SAVING_CAP = 120;
  const SOURCE = { nz: "Stats NZ population; OpenRouteService drive times; Altitude catchments (Beta)",
    au: "ABS population; OpenRouteService drive times; Altitude catchments (Beta)",
    ie: "CSO Census 2022 population; Tailte Éireann boundaries; OpenRouteService drive times; Altitude catchments (Beta)" };
  const cache = {};
  let data, shapes, map, areaLayer, airportLayer, catchmentLayer, rows = [], loadNumber = 0;
  let outlineKey, outlineGeometry, linked = null;

  const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const people = n => Math.round(n).toLocaleString("en-NZ");
  const minutes = n => n == null || !isFinite(n) ? "–" : Math.round(n) + " min";

  function hex(c) { return [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); }
  function ramp(stops, t) {
    t = Math.min(1, Math.max(0, isFinite(t) ? t : 0));
    const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    const a = hex(stops[i]), b = hex(stops[i + 1]);
    return "#" + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, "0")).join("");
  }

  async function load(country) {
    if (!cache[country]) {
      cache[country] = Promise.all(["json", "geojson"].map(ext => fetch(`${country}.${ext}`).then(r => {
        if (!r.ok) throw new Error(`Could not load ${country}.${ext}`);
        return r.json();
      })));
      cache[country].catch(() => delete cache[country]);
    }
    return cache[country];
  }

  function ticks(box, items, checked) {
    box.replaceChildren(...items.map(({ value, label }) => {
      const wrap = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.checked = checked.includes(value);
      wrap.append(input, " " + label);
      return wrap;
    }));
  }
  const ticked = box => [...box.querySelectorAll("input:checked")].map(input => input.value);

  function setAirport(code) {
    $("airport").value = code;
    const others = data.airports.filter(a => a.code !== code);
    ticks($("competitors"), others.map(a => ({ value: a.code, label: a.code })),
      others.filter(a => a.major).map(a => a.code));
  }

  async function setCountry(country, airport) {
    const number = ++loadNumber;
    $("summary").textContent = "Loading map…";
    $("csv").disabled = true;
    try {
      [data, shapes] = await load(country);
    } catch (error) {
      $("summary").textContent = "The map data could not be loaded. Please try again later.";
      return;
    }
    if (number !== loadNumber) return;
    outlineKey = null;
    const shared = linked;
    linked = null;
    $("airport").replaceChildren(...data.airports.map(a => new Option(`${a.name} (${a.code})`, a.code)));
    const codes = data.airports.map(a => a.code);
    setAirport(codes.includes(airport) ? airport : (codes.includes(DEFAULT_AIRPORT[country]) ? DEFAULT_AIRPORT[country] : codes[0]));
    const regions = [...new Set(data.areas.region.filter(Boolean))].sort();
    $("regions-box").hidden = !regions.length;
    $("regions-label").textContent = country === "ie" ? "Counties shown" : "States shown";
    ticks($("regions"), regions.map(r => ({ value: r, label: r })), regions);
    if (shared) applyLink(shared);
    $("notice").textContent = data.notice;
    update(true);
  }

  // Shareable links: country, airport and view always; rivals, threshold and radius when changed.
  function linkParams(result, style) {
    const params = new URLSearchParams({ country: $("country").value, airport: result.airport, style });
    const majors = data.airports.filter(a => a.major && a.code !== result.airport).map(a => a.code).sort();
    const rivals = [...result.competitors].sort();
    if (rivals.join(",") !== majors.join(",")) params.set("rivals", rivals.join(","));
    if (result.threshold) params.set("threshold", result.threshold);
    if (result.radius !== 400) params.set("radius", result.radius);
    return params;
  }

  // Applies a link's rivals, threshold and radius once the country's airports are listed.
  function applyLink(params) {
    if (params.has("rivals")) {
      const wanted = new Set(params.get("rivals").split(",").map(c => c.trim().toUpperCase()));
      for (const input of $("competitors").querySelectorAll("input")) input.checked = wanted.has(input.value);
    }
    const number = (key, lo, hi) => {
      const value = Number(params.get(key));
      if (params.has(key) && isFinite(value) && value >= lo && value <= hi) $(key).value = value;
    };
    number("threshold", 0, 240);
    number("radius", 1, 400);
  }

  // Road minutes where routed; otherwise straight-line km at 60 km/h, i.e. one minute per km.
  function travel(code, i) {
    const road = data.minutes[code]?.[i];
    if (road != null) return { minutes: road, proxy: false };
    const km = data.straight_km[code]?.[i];
    return km == null ? { minutes: null, proxy: true } : { minutes: km, proxy: true };
  }

  function compute() {
    const airport = $("airport").value, competitors = ticked($("competitors"));
    const threshold = Number($("threshold").value) || 0;
    const radius = Math.min(400, Math.max(1, Number($("radius").value) || 400));
    const regionFilter = $("regions-box").hidden ? null : new Set(ticked($("regions")));
    const out = [];
    data.areas.code.forEach((code, i) => {
      if (!(data.straight_km[airport][i] <= radius)) return;
      if (regionFilter && !regionFilter.has(data.areas.region[i])) return;
      const own = travel(airport, i);
      let best = null;
      for (const c of competitors) {
        const t = travel(c, i);
        if (t.minutes == null) { best = null; break; }
        if (!best || t.minutes < best.minutes) best = { ...t, airport: c };
      }
      const saving = own.minutes != null && best ? best.minutes - own.minutes : null;
      out.push({ i, code, name: data.areas.name[i], region: data.areas.region[i],
        population: data.areas.population[i], density: data.areas.density[i],
        own, best, saving, included: saving != null && saving >= threshold });
    });
    return { airport, competitors, threshold, radius, rows: out };
  }

  function colourer(style, shown) {
    if (style === "density") {
      const values = shown.map(r => Math.log1p(r.density)).filter(isFinite);
      const lo = Math.min(...values), hi = Math.max(...values);
      return { colour: r => r.density != null && isFinite(r.density) ? ramp(DENSITY, (Math.log1p(r.density) - lo) / ((hi - lo) || 1)) : null,
        legend: [`${people(Math.expm1(lo))}`, `${people(Math.expm1(hi))} people per km²`], stops: DENSITY };
    }
    const extent = Math.min(SAVING_CAP, Math.max(1, ...shown.map(r => Math.abs(r.saving ?? 0))));
    return { colour: r => r.saving == null ? null : ramp(SAVING, (r.saving + extent) / (2 * extent)),
      legend: [`${Math.round(extent)}${extent === SAVING_CAP ? "+" : ""} min further`, `${Math.round(extent)}${extent === SAVING_CAP ? "+" : ""} min closer`], stops: SAVING };
  }

  function popup(r, airport) {
    const best = r.best;
    return `<strong>${escape(r.name)}</strong><br>Population: ${people(r.population)}` +
      `<br>${escape(airport)}: ${minutes(r.own.minutes)}${r.own.proxy ? " (straight-line estimate)" : " by road"}` +
      (best ? `<br>Nearest competitor: ${escape(best.airport)}, ${minutes(best.minutes)}${best.proxy ? " (straight-line estimate)" : " by road"}` +
        `<br>Time saved: ${minutes(r.saving)}` : "<br>No competitor selected") +
      `<br>In catchment: ${r.included ? "yes" : "no"}`;
  }

  function update(fit) {
    if (!data || !window.L) return;
    const result = compute(), style = $("style").value;
    rows = result.rows;
    const byIndex = new Map(rows.map(r => [r.i, r]));
    const scale = colourer(style, rows);
    if (!map) {
      map = L.map("map", { preferCanvas: true, scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    }
    areaLayer?.remove();
    areaLayer = L.geoJSON(shapes, {
      filter: f => byIndex.has(f.properties.i),
      style: f => {
        const r = byIndex.get(f.properties.i), fill = scale.colour(r);
        return { fillColor: fill || "#ffffff", fillOpacity: fill ? 0.7 : 0, color: "#888888",
          stroke: $("block-borders").checked, weight: 0.3, opacity: 1 };
      },
      onEachFeature: (f, layer) => layer.bindPopup(() => popup(byIndex.get(f.properties.i), result.airport))
    }).addTo(map);
    catchmentLayer?.remove();
    if ($("catchment-outline").checked) {
      const included = new Set(rows.filter(r => r.included).map(r => r.i));
      const key = [...included].join(",");
      if (key !== outlineKey) {
        outlineGeometry = CatchmentOutline.merge(data.outlines.features, included);
        outlineKey = key;
      }
      catchmentLayer = L.geoJSON(outlineGeometry, {
        style: { color: "#E5AD3D", weight: 2, fill: false, interactive: false },
        interactive: false
      }).addTo(map);
    }
    airportLayer?.remove();
    airportLayer = L.layerGroup(data.airports.filter(a => a.code === result.airport || result.competitors.includes(a.code)).map(a =>
      L.circleMarker([a.lat, a.lon], { radius: a.code === result.airport ? 8 : 6, color: "#ffffff", weight: 2,
        fillColor: "#163B4C", fillOpacity: 1 }).bindTooltip(a.code, { permanent: true, direction: "right", offset: [6, 0] }))).addTo(map);
    if (fit) {
      const bounds = areaLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [10, 10] });
    }
    summary(result);
    legend(scale, style);
    bands(result);
    $("csv").disabled = !rows.length;
    history.replaceState(null, "", `?${linkParams(result, style)}`);
  }

  function summary(result) {
    const box = $("summary");
    if (!result.rows.length) { box.textContent = "No populated areas match these options."; return; }
    const total = result.rows.reduce((s, r) => s + r.population, 0);
    const inside = result.rows.filter(r => r.included).reduce((s, r) => s + r.population, 0);
    const proxies = result.rows.filter(r => r.own.proxy || r.best?.proxy).length;
    box.innerHTML = `<strong>${people(inside)}</strong> people live in ${escape(result.airport)}'s catchment, out of ` +
      `<strong>${people(total)}</strong> in the ${result.rows.length.toLocaleString("en-NZ")} areas shown. ` +
      (result.competitors.length
        ? `Catchment means at least ${result.threshold} minutes closer by road than ${escape(result.competitors.join(", "))}.`
        : "Tick at least one competing airport to see a catchment.") +
      (proxies ? ` ${proxies} areas use a straight-line estimate.` : "");
  }

  function legend(scale, style) {
    const box = $("legend");
    const gradient = `linear-gradient(to right, ${scale.stops.join(", ")})`;
    box.innerHTML = `<span>${escape(scale.legend[0])}</span><span class="ramp" style="background:${gradient}"></span>` +
      `<span>${escape(scale.legend[1])}</span>` +
      ($("catchment-outline").checked ? '<span class="outline"></span><span>Catchment boundary</span>' : "");
    box.title = style === "density" ? "Population density (log scale)" : "Minutes saved compared with the nearest competitor";
  }

  function bands(result) {
    const labels = BANDS.slice(0, -1).map((lo, k) => isFinite(BANDS[k + 1]) ? `${lo}–${BANDS[k + 1]} min` : `${lo}+ min`);
    const totals = labels.map(() => [0, 0]);
    for (const r of result.rows) {
      const m = r.own.minutes;
      if (m == null) continue;
      const k = Math.max(0, BANDS.findIndex((hi, j) => j > 0 && m <= hi) - 1);
      totals[k][0] += r.population;
      if (r.included) totals[k][1] += r.population;
    }
    let all = 0, inside = 0;
    $("bands").innerHTML = labels.map((label, k) => {
      all += totals[k][0]; inside += totals[k][1];
      return `<tr><td>${label}</td><td>${people(totals[k][0])}</td><td>${people(all)}</td><td>${people(totals[k][1])}</td><td>${people(inside)}</td></tr>`;
    }).join("");
  }

  function downloadCsv() {
    const airport = $("airport").value;
    const header = ["area_code", "area_name", "region", "population", "people_per_km2", "airport", "airport_minutes",
      "airport_method", "nearest_competitor", "competitor_minutes", "competitor_method", "minutes_saved", "in_catchment", "source"];
    const method = t => t.proxy ? "Straight-line estimate at 60 km/h" : "Road route";
    const cell = v => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const lines = rows.map(r => [r.code, r.name, r.region, r.population, r.density, airport, r.own.minutes, method(r.own),
      r.best?.airport, r.best?.minutes, r.best ? method(r.best) : null, r.saving == null ? null : Math.round(r.saving * 10) / 10,
      r.included ? "yes" : "no", SOURCE[$("country").value]].map(cell).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n") + "\n"], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${$("country").value}_${airport}_catchment.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function start() {
    if (!window.L || !window.polygonClipping || !window.CatchmentOutline) {
      $("summary").textContent = "The map library could not be loaded. Please try again later."; return;
    }
    if (matchMedia("(max-width: 799px)").matches) $("options").open = false;
    const params = new URLSearchParams(location.search);
    const country = ["nz", "au", "ie"].includes(params.get("country")) ? params.get("country") : "nz";
    $("country").value = country;
    if (["density", "advantage"].includes(params.get("style"))) $("style").value = params.get("style");
    linked = params;
    $("country").addEventListener("change", () => setCountry($("country").value));
    $("airport").addEventListener("change", () => { setAirport($("airport").value); update(true); });
    for (const id of ["competitors", "regions"]) $(id).addEventListener("change", () => update(id === "regions"));
    $("style").addEventListener("change", () => update(false));
    for (const id of ["block-borders", "catchment-outline"]) $(id).addEventListener("change", () => update(false));
    for (const id of ["threshold", "radius"]) $(id).addEventListener("change", () => update(id === "radius"));
    $("csv").addEventListener("click", downloadCsv);
    setCountry(country, params.get("airport"));
  }
  window.addEventListener("DOMContentLoaded", start);
})();
