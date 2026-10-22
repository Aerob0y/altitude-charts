// Page wiring for the Auckland homes map. Logic lives in donut.js.
(() => {
  const D = window.Donut;
  const $ = id => document.getElementById(id);
  const DECK_SRC = "vendor/deck.gl-9.1.14.min.js";
  // Navy and teal match the charts; red marks areas that lost people. Light grey and light teal read better on the map.
  const COLOURS = {navy: [18, 36, 61], teal: [14, 107, 107], lightTeal: [77, 166, 160], red: [190, 50, 50],
    grey: [176, 174, 168], people: [138, 135, 129], ring: [100, 103, 108]};
  const SHADES = {inner: [14, 107, 107, 34], outer: [200, 120, 30, 30]};
  const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const RADIUS = 150, SHIFT = 170;
  const KEY_RINGS = [2, 6, 10, 18, 30];
  const narrow = () => innerWidth < 600;
  const home = () => ({longitude: 174.77, latitude: narrow() ? -36.93 : -36.9, zoom: narrow() ? 9.5 : 10.4,
    pitch: 50, bearing: -12, minZoom: 7, maxZoom: 15, maxPitch: 70});
  let data, map, story, scales = {}, selected = null;
  const hidden = new Set();

  const settings = () => ({
    step: document.querySelector("input[name=step]:checked").value,
    from: Math.min(Number($("since").value), Number($("until").value)),
    to: Math.max(Number($("since").value), Number($("until").value)),
    mode: "homes",
    measure: document.querySelector("input[name=measure]:checked").value,
    urbanOnly: $("urban").checked
  });

  function setStatus(text, error = false) {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
  }

  function webglAvailable() {
    try { return !!document.createElement("canvas").getContext("webgl2"); } catch (e) { return false; }
  }

  function loadDeck() {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = DECK_SRC;
      script.onload = resolve;
      script.onerror = () => reject(new Error("The map library did not load."));
      document.head.append(script);
    });
  }

  // Story rows are fixed per scope; rates and shares always use the urban area or region as a whole.
  function storyFor(s) {
    const key = s.urbanOnly ? "urban" : "region";
    if (!story || story.key !== key) story = {key, list: D.storyRows(data, {urbanOnly: s.urbanOnly})};
    return story.list;
  }

  // Fixed scales per view, so moving the slider changes bar heights rather than the scale.
  // A few tiny city-centre areas would flatten every other bar, so they run off the top.
  // Growth rates have a long tail of new suburbs, so their scale uses the 90th percentile.
  function scaleFor(s, list) {
    const key = [s.step, s.measure, s.urbanOnly].join("/");
    if (!scales[key]) {
      const top = (values, q = 0.98) => D.niceStep(D.quantile(values, q));
      if (s.step === "density") scales[key] = {value: top(list.map(r => Math.max(r.density_2013, r.density_2023)))};
      else if (s.step === "share") scales[key] = {value: top(list.flatMap(r => [r.residents_share, Math.abs(r.added_share)]))};
      else if (s.step === "pace") scales[key] = {value: top(list.filter(r => r.growth_a_year !== null).map(r => Math.abs(r.growth_a_year)), 0.9)};
      else {
        const widest = D.rows(data, {...s, from: data.years.includes(1991) ? 1991 : data.years[0], to: data.years[data.years.length - 1]});
        const pick = values => (s.measure === "hectare" ? D.quantile(values, 0.98) : Math.max(...values));
        scales[key] = {people: D.niceStep(pick(widest.map(r => r.people_value))),
          outcome: D.niceStep(pick(widest.map(r => Math.abs(r.outcome_value))))};
      }
    }
    return scales[key];
  }

  // Bars stop at 8 km high, so a few very dense city-centre areas don't hide the rest; the key says so.
  const CAP_KM = 8;
  const elevation = (value, step) => 1000 * Math.min(CAP_KM, Math.abs(value) / step);

  // `base` lifts a bar so it starts where another ends, for stacked bars.
  function column(id, list, s, {value, colour, shift = 0, radius = RADIUS, step, base = () => 0, opacity = 0.94}) {
    return new deck.ColumnLayer({
      id, data: list, diskResolution: 12, radius, extruded: true, pickable: true, visible: !hidden.has(id),
      getPosition: r => [...(shift ? D.offset(r.lon, r.lat, shift) : [r.lon, r.lat]), elevation(base(r), step)],
      getElevation: r => elevation(base(r) + Math.abs(value(r)), step) - elevation(base(r), step),
      getFillColor: r => [...(typeof colour === "function" ? colour(r) : colour), Math.round(255 * opacity)],
      updateTriggers: {getElevation: [s.step, s.from, s.to, s.measure, s.urbanOnly], getPosition: [s.step, s.urbanOnly], getFillColor: [s.step, s.urbanOnly]},
      material: {ambient: 0.55, diffuse: 0.55, shininess: 12}
    });
  }

  // Mix from a pale tint (t = 0) to the full colour (t = 1), so stronger rates show as deeper shades.
  function ramp(rgb, t) {
    const k = 0.25 + 0.75 * Math.max(0, Math.min(1, t));
    return rgb.map(c => Math.round(240 + (c - 240) * k));
  }

  // Each item is one key entry and one layer, so the key can switch it off.
  function bars(s) {
    if (s.step === "homes") {
      const list = D.rows(data, s);
      const scale = scaleFor(s, list);
      return {list, items: [
        {id: "people", colour: COLOURS.people, label: "Grey, people in 2023" + (s.measure === "hectare" ? " per hectare" : ""),
          layer: column("people", list, s, {value: r => r.people_value, colour: COLOURS.people, shift: -SHIFT, step: scale.people})},
        {id: "homes", colour: COLOURS.teal, label: `Teal, new homes ${s.from}–${s.to}` + (s.measure === "hectare" ? " per hectare" : ""),
          layer: column("homes", list, s, {value: r => r.outcome_value, colour: COLOURS.teal, shift: SHIFT, step: scale.outcome})}
      ]};
    }
    const list = storyFor(s);
    const step = scaleFor(s, list).value;
    if (s.step === "density") {
      // The grey base is the lower of the two densities; the change sits on top of it.
      const low = r => Math.min(r.density_2013, r.density_2023);
      const change = r => r.density_2023 - r.density_2013;
      return {list, items: [
        {id: "base", colour: COLOURS.grey, label: "People per hectare, 2013 (or 2023 where it fell)",
          layer: column("base", list, s, {value: low, colour: COLOURS.grey, step, opacity: 0.7})},
        {id: "added", colour: COLOURS.lightTeal, label: "Added by 2023",
          layer: column("added", list.filter(r => change(r) > 0), s, {value: change, base: low, colour: COLOURS.lightTeal, step, opacity: 0.7})},
        {id: "lost", colour: COLOURS.red, label: "Lost by 2023",
          layer: column("lost", list.filter(r => change(r) < 0), s, {value: change, base: low, colour: COLOURS.red, step, opacity: 0.7})}
      ]};
    }
    if (s.step === "share") {
      return {list, items: [
        {id: "residents", colour: COLOURS.grey, label: "Share of 2013 residents",
          layer: column("residents", list, s, {value: r => r.residents_share, colour: COLOURS.grey, shift: -SHIFT, step, opacity: 0.7})},
        {id: "added", colour: COLOURS.navy, label: "Share of people added",
          layer: column("added", list.filter(r => r.added_share >= 0), s, {value: r => r.added_share, colour: COLOURS.navy, shift: SHIFT, step})},
        {id: "lost", colour: COLOURS.red, label: "The area lost people",
          layer: column("lost", list.filter(r => r.added_share < 0), s, {value: r => r.added_share, colour: COLOURS.red, shift: SHIFT, step})}
      ]};
    }
    const average = D.totals(list).growth_a_year;
    const rated = list.filter(r => r.growth_a_year !== null);
    const scope = s.urbanOnly ? "the urban area" : "the region";
    const top = CAP_KM * step;
    return {list: rated, items: [
      {id: "faster", colour: COLOURS.navy, label: `Faster than ${scope} as a whole (${pct(average, 1)} a year)`,
        layer: column("faster", rated.filter(r => r.growth_a_year > average), s, {value: r => r.growth_a_year, step,
          colour: r => ramp(COLOURS.navy, (r.growth_a_year - average) / (top - average))})},
      {id: "slower", colour: COLOURS.teal, label: `Slower than ${scope} as a whole`,
        layer: column("slower", rated.filter(r => r.growth_a_year >= 0 && r.growth_a_year <= average), s, {value: r => r.growth_a_year, step,
          colour: r => ramp(COLOURS.teal, (average - r.growth_a_year) / average)})},
      {id: "lost", colour: COLOURS.red, label: "The area lost people",
        layer: column("lost", rated.filter(r => r.growth_a_year < 0), s, {value: r => r.growth_a_year, step,
          colour: r => ramp(COLOURS.red, -r.growth_a_year / 0.02)})}
    ]};
  }

  function baseLayers() {
    const rings = Array.from({length: 15}, (_, i) => 2 * (i + 1)).map(km => ({km, key: KEY_RINGS.includes(km), path: D.ring(km)}));
    const shades = [
      {polygon: D.annulus(2, 6), colour: SHADES.inner, label: "Inner suburbs, 2–6 km", at: D.ring(4, 8)[4]},
      {polygon: D.annulus(18, 50), colour: SHADES.outer, label: "Beyond 18 km", at: D.ring(20, 8)[4]}
    ];
    const flat = {parameters: {depthWriteEnabled: false, depthCompare: "always"}};
    const text = {fontFamily: "Inter, Arial, sans-serif", characterSet: "auto", background: true, getBackgroundColor: [255, 255, 255, 210], backgroundPadding: [4, 2]};
    const labels = [
      new deck.TextLayer({id: "ring-labels", data: rings.filter(r => r.key), getPosition: r => r.path[0], getText: r => r.km + " km",
        getSize: 12, getColor: [...COLOURS.ring, 240], getPixelOffset: [0, -8], ...text, ...flat}),
      new deck.TextLayer({id: "shade-labels", data: shades, getPosition: r => r.at, getText: r => r.label,
        getSize: 12, getColor: [34, 35, 38, 230], ...text, ...flat})
    ];
    return {labels, layers: [
      new deck.TileLayer({
        id: "basemap", data: TILES, minZoom: 0, maxZoom: 19, tileSize: 256,
        renderSubLayers: props => {
          const [[west, south], [east, north]] = props.tile.boundingBox;
          // Muted so the bars stand out against the standard OpenStreetMap colours.
          return new deck.BitmapLayer(props, {data: null, image: props.data, bounds: [west, south, east, north], desaturate: 0.7});
        }
      }),
      new deck.SolidPolygonLayer({id: "shades", data: shades, getPolygon: r => r.polygon, getFillColor: r => r.colour, ...flat}),
      new deck.PathLayer({id: "rings", data: rings, getPath: r => r.path, getColor: r => [...COLOURS.ring, r.key ? 190 : 70],
        getWidth: r => (r.key ? 2 : 1), widthUnits: "pixels", ...flat})
    ]};
  }

  function swatch(rgb) { return `<span class="swatch" style="background: rgb(${rgb.join(",")})"></span>`; }
  const pct = (value, digits = 0) => (value === null ? "–" : D.format(100 * value, digits) + "%");

  function drawKey(s, list, items) {
    if (!list.length) { $("key").innerHTML = ""; return; }
    const buttons = items.map(item => `<button type="button" class="toggle" data-layer="${item.id}" aria-pressed="${!hidden.has(item.id)}">` +
      `${swatch(item.colour)}${escapeHtml(item.label)}</button>`);
    const notes = [];
    if (s.step === "density") notes.push(`Each 1 km of height is ${D.format(scaleFor(s, list).value)} people per hectare.`);
    if (s.step === "share") notes.push("Both bars use the same scale.");
    if (s.step === "pace") notes.push("Deeper shades are further from the average.");
    if (s.step === "homes") notes.push(...homesKey(s, list), "Grey and teal use different scales.");
    else {
      const step = scaleFor(s, list).value;
      const value = {density: r => Math.max(r.density_2013, r.density_2023), share: r => Math.max(r.residents_share, Math.abs(r.added_share)),
        pace: r => Math.abs(r.growth_a_year)}[s.step];
      const cut = list.filter(r => value(r) / step > CAP_KM).length;
      const top = s.step === "density" ? D.format(CAP_KM * step) + " people per hectare" : pct(CAP_KM * step, s.step === "share" ? 1 : 0);
      if (cut) notes.push(`${cut} ${cut === 1 ? "bar is" : "bars are"} cut off at ${top}.`);
    }
    $("key").innerHTML = buttons.join("") + notes.map(note => `<span class="note">${note}</span>`).join("") +
      '<span class="note hint">Tap a colour to hide or show it.</span>';
  }

  function homesKey(s, list) {
    const digits = s.measure === "hectare" ? 1 : 0;
    const tallest = key => list.reduce((best, r) => (Math.abs(r[key]) > Math.abs(best[key]) ? r : best), list[0]);
    const line = (label, key) => {
      const top = tallest(key);
      return `Tallest ${label}: ${D.format(Math.abs(top[key]), digits)} (${escapeHtml(top.name)})`;
    };
    return [line("grey", "people_value"), line("teal", "outcome_value")];
  }

  function drawSummary(s) {
    // The study covers the urban area, whatever the map shows.
    const urban = D.storyRows(data, {urbanOnly: true});
    const g = D.groups(urban), all = D.totals(urban);
    const one = value => D.format(value, 1);
    const lines = {
      density: [`At the centre, within 2 km of Britomart, there were <strong>${one(g.centre.density_2023)}</strong> people per hectare in 2023, up from ${one(g.centre.density_2013)} in 2013.`,
        `The inner suburbs, 2 to 6 km out, had ${one(g.inner.density_2013)} and <strong>${one(g.inner.density_2023)}</strong>. Beyond 18 km, density rose from ${one(g.outer.density_2013)} to <strong>${one(g.outer.density_2023)}</strong>.`],
      share: [`The inner suburbs held <strong>${pct(g.inner.residents_share)}</strong> of the urban area's 2013 residents but took only <strong>${pct(g.inner.added_share)}</strong> of the ${D.format(all.added)} people added by 2023.`,
        `Beyond 18 km held ${pct(g.outer.residents_share)} of residents and took <strong>${pct(g.outer.added_share)}</strong> of the people added.`],
      pace: [`The urban area grew by <strong>${pct(all.growth_a_year, 1)}</strong> a year between the 2013 and 2023 Censuses.`,
        `The inner suburbs grew by <strong>${pct(g.inner.growth_a_year, 1)}</strong> a year. Beyond 18 km grew by <strong>${pct(g.outer.growth_a_year, 1)}</strong> a year.`],
      homes: homesSummary(s)
    };
    $("summary").innerHTML = lines[s.step].map(line => `<p>${line}</p>`).join("");
  }

  function homesSummary(s) {
    const sum = D.summary(data, {...s, urbanOnly: true});
    const last = () => data.years[data.years.length - 1];
    const inner = D.rows(data, {...s, urbanOnly: true}).filter(r => r.dist_km >= 2 && r.dist_km < 6).reduce((total, r) => total + r.homes, 0);
    const km = value => (value === null ? "–" : D.format(value, 1) + " km");
    return [`Between January ${s.from} and ${s.to === last() ? D.monthLabel(data.last_month) : "December " + s.to}, Auckland's urban area consented <strong>${D.format(sum.outcome)}</strong> new homes, against ${D.format(sum.people)} residents in the 2023 Census.`,
      `<strong>${D.format(inner)}</strong> of them are in the inner suburbs, 2 to 6 km from Britomart. Half of residents live within ${km(sum.people_half_km)}; half of the new homes are within <strong>${km(sum.outcome_half_km)}</strong>.`];
  }

  function detailsHtml(code, s) {
    const r = D.rows(data, {...s, urbanOnly: false}).find(row => row.code === code);
    const story = D.storyRows(data, {urbanOnly: false}).find(row => row.code === code);
    if (!r || !story) return null;
    const types = data.types.map((type, i) => `<tr><td>${D.TYPE_LABELS[type] || type}</td><td>${D.format(r.homes_by_type[i])}</td></tr>`).join("");
    const change = r.growth >= 0 ? "+" + D.format(r.growth) : "−" + D.format(-r.growth);
    return `<h3>${escapeHtml(r.name)}</h3>
      <p class="hint">${D.format(r.dist_km, 1)} km from Britomart · ${r.urban ? "urban area" : "outside the urban area"} · ${D.format(r.land_ha)} ha of land</p>
      <table>
        <tr><td>People, 2013 Census</td><td>${D.format(r.pop_2013)}</td></tr>
        <tr><td>People, 2023 Census</td><td>${D.format(r.pop_2023)}</td></tr>
        <tr><td>Change</td><td>${change}</td></tr>
        <tr><td>People per hectare, 2013 and 2023</td><td>${D.format(story.density_2013, 1)} and ${D.format(story.density_2023, 1)}</td></tr>
        <tr><td>Growth a year</td><td>${pct(story.growth_a_year, 1)}</td></tr>
        <tr><td><strong>New homes ${s.from}–${s.to}</strong></td><td><strong>${D.format(r.homes)}</strong></td></tr>
        ${types}
      </table>`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  }

  function tooltip({object, layer}) {
    if (!object || !layer || !layer.id || !object.code) return null;
    const s = settings();
    const line = {
      density: `${D.format(object.density_2013, 1)} → ${D.format(object.density_2023, 1)} people per hectare (2013 to 2023)`,
      share: `${pct(object.residents_share, 2)} of 2013 residents · ${pct(object.added_share, 2)} of people added`,
      pace: `${pct(object.growth_a_year, 1)} a year, 2013 to 2023`,
      homes: `${D.format(object.pop_2023)} people · ${D.format(object.homes)} new homes ${s.from}–${s.to}`
    }[s.step];
    return {html: `<strong>${escapeHtml(object.name)}</strong><br>${line}`,
      style: {background: "white", color: "#222326", border: "1px solid #DCD6CB", fontFamily: "Inter, Arial, sans-serif", fontSize: "12px", padding: "6px 8px"}};
  }

  function render() {
    const s = settings();
    const last = data.years[data.years.length - 1];
    $("since-value").textContent = s.from;
    $("until-value").textContent = s.to;
    $("since-box").hidden = s.step !== "homes";
    $("since-hint").textContent = `January ${s.from} to ${s.to === last ? D.monthLabel(data.last_month) : "December " + s.to}.` +
      (s.to === last ? ` ${last} is part of a year only.` : "");
    const {list, items} = bars(s);
    const layers = items.map(item => item.layer);
    const base = baseLayers();
    map.setProps({layers: [...base.layers, ...layers, ...base.labels]});
    drawKey(s, list, items);
    drawSummary(s);
    if (selected) {
      const html = detailsHtml(selected, s);
      $("details").hidden = !html;
      if (html) $("details").innerHTML = html;
    }
  }

  function start() {
    const years = data.years.filter(year => year >= 1991);
    for (const id of ["since", "until"]) {
      $(id).min = years[0];
      $(id).max = years[years.length - 1];
    }
    $("until").value = years[years.length - 1];
    $("source").textContent = `Source: ${data.source}. Consents to ${D.monthLabel(data.last_month)}.`;
    map = new deck.DeckGL({
      container: "map", initialViewState: home(), controller: true, getTooltip: tooltip,
      onClick: ({object}) => {
        if (!object || !object.code) return;
        selected = object.code;
        render();
      }
    });
    for (const input of document.querySelectorAll("input[name=step]")) input.addEventListener("input", () => hidden.clear());
    for (const input of document.querySelectorAll("#controls input")) input.addEventListener("input", render);
    $("key").addEventListener("click", event => {
      const button = event.target.closest("button[data-layer]");
      if (!button) return;
      const id = button.dataset.layer;
      if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
      render();
    });
    $("reset").addEventListener("click", () => map.setProps({initialViewState: {...home(), transitionDuration: 600}}));
    setStatus("");
    render();
  }

  function fallback(message) {
    setStatus(message, true);
    $("map").innerHTML = `<p class="fallback">${escapeHtml(message)} The <a href="../miscellaneous/">charts</a> show the same evidence without a 3D map.</p>`;
    $("key").innerHTML = "";
  }

  fetch("data/donut.json")
    .then(response => { if (!response.ok) throw new Error("The map data did not load."); return response.json(); })
    .then(json => {
      data = json;
      if (!webglAvailable()) {
        drawSummary(settings());
        throw new Error("This browser can't draw 3D maps.");
      }
      return loadDeck();
    })
    .then(start)
    .catch(error => fallback(error.message));
})();
