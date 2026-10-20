// Page wiring for the Auckland homes map. Logic lives in donut.js.
(() => {
  const D = window.Donut;
  const $ = id => document.getElementById(id);
  const DECK_SRC = "vendor/deck.gl-9.1.14.min.js";
  const COLOURS = {people: [138, 135, 129], homes: [14, 107, 107], loss: [200, 120, 30], ring: [100, 103, 108]};
  const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const RADIUS = 150, SHIFT = 170;
  const narrow = () => innerWidth < 600;
  const home = () => ({longitude: 174.77, latitude: narrow() ? -36.93 : -36.9, zoom: narrow() ? 9.5 : 10.4,
    pitch: 50, bearing: -12, minZoom: 7, maxZoom: 15, maxPitch: 70});
  let data, map, scales = {}, selected = null;

  const settings = () => ({
    from: Number($("since").value),
    mode: document.querySelector("input[name=mode]:checked").value,
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

  // Fixed scales per view, so moving the slider changes bar heights rather than the scale.
  function scaleFor(s) {
    const key = [s.mode, s.measure, s.urbanOnly].join("/");
    if (!scales[key]) {
      const widest = D.rows(data, {...s, from: data.years.includes(1991) ? 1991 : data.years[0]});
      // Per hectare, a few tiny city-centre areas would flatten every other bar, so they run off the top.
      const top = values => (s.measure === "hectare" ? D.quantile(values, 0.98) : Math.max(...values));
      scales[key] = {
        people: D.niceStep(top(widest.map(r => r.people_value))),
        outcome: D.niceStep(top(widest.map(r => Math.abs(r.outcome_value))))
      };
    }
    return scales[key];
  }

  function units(s) {
    const area = s.measure === "hectare" ? " per hectare" : "";
    return {
      people: (s.mode === "growth" ? "people in 2013" : "people in 2023") + area,
      outcome: (s.mode === "growth" ? "people gained or lost, 2013 to 2023" : "new homes since " + s.from) + area
    };
  }

  function layers(list, s, scale) {
    const elevation = (value, step) => 1000 * Math.abs(value) / step;
    const columns = (id, value, colour, shift) => new deck.ColumnLayer({
      id, data: list, diskResolution: 12, radius: RADIUS, extruded: true, pickable: true,
      getPosition: r => D.offset(r.lon, r.lat, shift),
      getElevation: r => elevation(value(r), scale[id]),
      getFillColor: r => (typeof colour === "function" ? colour(r) : colour),
      updateTriggers: {getElevation: [s.from, s.mode, s.measure, s.urbanOnly], getFillColor: [s.mode]},
      material: {ambient: 0.55, diffuse: 0.55, shininess: 12}
    });
    const rings = [5, 10, 20, 30].map(km => ({km, path: D.ring(km)}));
    return [
      new deck.TileLayer({
        id: "basemap", data: TILES, minZoom: 0, maxZoom: 19, tileSize: 256,
        renderSubLayers: props => {
          const [[west, south], [east, north]] = props.tile.boundingBox;
          // Muted so the bars stand out against the standard OpenStreetMap colours.
          return new deck.BitmapLayer(props, {data: null, image: props.data, bounds: [west, south, east, north], desaturate: 0.7});
        }
      }),
      new deck.PathLayer({id: "rings", data: rings, getPath: r => r.path, getColor: [...COLOURS.ring, 150],
        getWidth: 1.5, widthUnits: "pixels"}),
      new deck.TextLayer({id: "ring-labels", data: rings, getPosition: r => r.path[0], getText: r => r.km + " km",
        getSize: 12, getColor: [...COLOURS.ring, 230], getPixelOffset: [0, -8], fontFamily: "Inter, Arial, sans-serif",
        background: true, getBackgroundColor: [255, 255, 255, 200], backgroundPadding: [3, 1]}),
      columns("people", r => r.people_value, [...COLOURS.people, 235], -SHIFT),
      columns("outcome", r => r.outcome_value, r => [...(r.outcome_value < 0 ? COLOURS.loss : COLOURS.homes), 245], SHIFT)
    ];
  }

  function swatch(rgb) { return `<span class="swatch" style="background: rgb(${rgb.join(",")})"></span>`; }

  function drawKey(s, list) {
    const u = units(s);
    const digits = s.measure === "hectare" ? 1 : 0;
    const tallest = key => list.reduce((best, r) => (Math.abs(r[key]) > Math.abs(best[key]) ? r : best), list[0]);
    const line = (colour, label, key) => {
      const top = tallest(key);
      return `${swatch(colour)}${label}: tallest ${D.format(Math.abs(top[key]), digits)} (${escapeHtml(top.name)})`;
    };
    $("key").innerHTML = !list.length ? "" :
      line(COLOURS.people, "Grey, " + u.people, "people_value") + "<br>" +
      line(COLOURS.homes, "Teal, " + u.outcome, "outcome_value") + "<br>" +
      (s.mode === "growth" ? `${swatch(COLOURS.loss)}Orange: the area lost people<br>` : "") +
      "Grey and teal use different scales.";
  }

  function drawSummary(s) {
    // The study covers the urban area, whatever the map shows.
    const sum = D.summary(data, {...s, urbanOnly: true});
    const scope = "Auckland's urban area";
    const km = value => (value === null ? "–" : D.format(value, 1) + " km");
    const lines = s.mode === "growth"
      ? [`Between the 2013 and 2023 Censuses, ${scope} gained <strong>${D.format(sum.outcome)}</strong> people.`,
        `In 2013, half its people lived within <strong>${km(sum.people_half_km)}</strong> of Britomart. Half of the growth came within <strong>${km(sum.outcome_half_km)}</strong>.`]
      : [`Since January ${s.from}, ${scope} has consented <strong>${D.format(sum.outcome)}</strong> new homes, against ${D.format(sum.people)} residents in the 2023 Census.`,
        `Half of residents live within <strong>${km(sum.people_half_km)}</strong> of Britomart. Half of the new homes are within <strong>${km(sum.outcome_half_km)}</strong>.`];
    const gap = sum.outcome_half_km - sum.people_half_km;
    if (Number.isFinite(gap)) {
      lines.push(Math.abs(gap) < 1 ? "On this measure, new building roughly follows where people already live."
        : gap > 0 ? `That is ${D.format(gap, 1)} km further out than where people live: a tilt towards the edges.`
          : `That is ${D.format(-gap, 1)} km closer in than where people live: a tilt towards the centre.`);
    }
    $("summary").innerHTML = lines.map(line => `<p>${line}</p>`).join("");
  }

  function detailsHtml(r, s) {
    const types = data.types.map((type, i) => `<tr><td>${D.TYPE_LABELS[type] || type}</td><td>${D.format(r.homes_by_type[i])}</td></tr>`).join("");
    const change = r.growth >= 0 ? "+" + D.format(r.growth) : "−" + D.format(-r.growth);
    return `<h3>${escapeHtml(r.name)}</h3>
      <p class="hint">${D.format(r.dist_km, 1)} km from Britomart · ${r.urban ? "urban area" : "outside the urban area"} · ${D.format(r.land_ha)} ha of land</p>
      <table>
        <tr><td>People, 2013 Census</td><td>${D.format(r.pop_2013)}</td></tr>
        <tr><td>People, 2023 Census</td><td>${D.format(r.pop_2023)}</td></tr>
        <tr><td>Change</td><td>${change}</td></tr>
        <tr><td><strong>New homes since ${s.from}</strong></td><td><strong>${D.format(r.homes)}</strong></td></tr>
        ${types}
        <tr><td>New homes per 100 residents</td><td>${r.per_100 === null ? "–" : D.format(r.per_100, 1)}</td></tr>
      </table>`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  }

  function tooltip({object, layer}) {
    if (!object || !layer || !["people", "outcome"].includes(layer.id)) return null;
    const s = settings();
    const line = s.mode === "growth"
      ? `${D.format(object.pop_2013)} → ${D.format(object.pop_2023)} people (2013 to 2023)`
      : `${D.format(object.pop_2023)} people · ${D.format(object.homes)} new homes since ${s.from}`;
    return {html: `<strong>${escapeHtml(object.name)}</strong><br>${line}`,
      style: {background: "white", color: "#222326", border: "1px solid #DCD6CB", fontFamily: "Inter, Arial, sans-serif", fontSize: "12px", padding: "6px 8px"}};
  }

  function render() {
    const s = settings();
    $("since-value").textContent = s.from;
    $("since-box").hidden = s.mode === "growth";
    $("since-hint").textContent = `January ${s.from} to ${D.monthLabel(data.last_month)}.` +
      (s.from === data.years[data.years.length - 1] ? " Part of a year only." : "");
    const list = D.rows(data, s);
    const scale = scaleFor(s);
    map.setProps({layers: layers(list, s, scale)});
    drawKey(s, list);
    drawSummary(s);
    if (selected) {
      const row = list.find(r => r.code === selected);
      $("details").hidden = !row;
      if (row) $("details").innerHTML = detailsHtml(row, s);
    }
  }

  function start() {
    const years = data.years.filter(year => year >= 1991);
    $("since").min = years[0];
    $("since").max = years[years.length - 1];
    $("source").textContent = `Source: ${data.source}. Consents to ${D.monthLabel(data.last_month)}.`;
    map = new deck.DeckGL({
      container: "map", initialViewState: home(), controller: true, getTooltip: tooltip,
      onClick: ({object, layer}) => {
        if (!object || !layer || !["people", "outcome"].includes(layer.id)) return;
        selected = object.code;
        render();
      }
    });
    for (const input of document.querySelectorAll("#controls input")) input.addEventListener("input", render);
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
