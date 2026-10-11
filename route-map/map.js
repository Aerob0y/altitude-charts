/* Reusable geometry and input validation. No browser or network dependencies. */
(function (root) {
  "use strict";
  const airports = {
    ZQN: [168.7392, -45.0211, "Queenstown"], AKL: [174.785, -37.0082, "Auckland"],
    SYD: [151.1772, -33.9461, "Sydney"], MEL: [144.841, -37.669, "Melbourne"],
    BNE: [153.1175, -27.3842, "Brisbane"], OOL: [153.5047, -28.1644, "Gold Coast"],
    CBR: [149.195, -35.3069, "Canberra"], CHC: [172.5322, -43.4894, "Christchurch"],
    WLG: [174.8053, -41.3272, "Wellington"], DUD: [170.1983, -45.9281, "Dunedin"],
    PER: [115.9672, -31.9403, "Perth"], ADL: [138.5306, -34.945, "Adelaide"],
    HBA: [147.5103, -42.8361, "Hobart"], CNS: [145.7553, -16.8858, "Cairns"],
    DUB: [-6.2701, 53.4213, "Dublin"], ORK: [-8.4911, 51.8413, "Cork"],
    SNN: [-8.9248, 52.702, "Shannon"], NOC: [-8.8185, 53.9103, "Ireland West"],
    KIR: [-9.5238, 52.1809, "Kerry"]
  };
  const MAX_ROWS = 2000;
  const number = (v, name, row, min, max) => {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(String(v).trim());
    if (!Number.isFinite(n) || n < min || n > max) throw Error(`Row ${row}: ${name} must be a number from ${min} to ${max}.`);
    return n;
  };
  // RFC 4180 fields, including quoted commas, quotes and embedded newlines.
  function parse_csv(text) {
    text = text.replace(/^\uFEFF/, "");
    const rows = []; let row = [], cell = "", quoted = false, closed = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') { quoted = false; closed = true; }
        else cell += c;
      } else if (c === '"') {
        if (cell || closed) throw Error("CSV: unexpected quote. Quote the whole field.");
        quoted = true;
      } else if (c === "," || c === "\n" || c === "\r") {
        row.push(cell); cell = ""; closed = false;
        if (c !== ",") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          if (row.some(v => v.trim())) rows.push(row);
          row = [];
        }
      } else {
        if (closed) throw Error("CSV: characters after a closing quote.");
        cell += c;
      }
    }
    if (quoted) throw Error("CSV: unclosed quoted field.");
    row.push(cell); if (row.some(v => v.trim())) rows.push(row);
    return rows;
  }
  const header = v => String(v).trim().toLowerCase().replace(/[\s-]+/g, "_");
  function normalise(table) {
    if (table.length < 2) throw Error("Include a header row and at least one route.");
    const columns = table[0].map(header);
    if (new Set(columns).size !== columns.length) throw Error("Column headings must be unique.");
    for (const key of ["origin", "destination"]) if (!columns.includes(key)) throw Error(`Missing column: ${key}.`);
    const rows = table.slice(1).filter(row => row.some(v => v != null && String(v).trim()));
    if (!rows.length) throw Error("No routes found.");
    if (rows.length > MAX_ROWS) throw Error(`Use at most ${MAX_ROWS} route rows.`);
    const coordinates = new Map();
    const parsed = rows.map((values, i) => {
      const row = i + 2, record = Object.fromEntries(columns.map((key, j) => [key, values[j] ?? ""]));
      if (values.length > columns.length) throw Error(`Row ${row}: more fields than column headings.`);
      const result = { airline: String(record.airline || "").trim().slice(0, 100) };
      for (const end of ["origin", "destination"]) {
        const code = String(record[end]).trim().toUpperCase();
        if (!/^[A-Z0-9]{3,4}$/.test(code)) throw Error(`Row ${row}: ${end} must be a 3–4 character airport code.`);
        result[end] = code;
        const lat = number(record[`${end}_lat`], `${end}_lat`, row, -90, 90);
        const lon = number(record[`${end}_lon`], `${end}_lon`, row, -180, 180);
        if ((lat == null) !== (lon == null)) throw Error(`Row ${row}: supply both latitude and longitude for ${code}.`);
        if (lat != null) {
          const previous = coordinates.get(code);
          if (previous && (Math.abs(previous[0] - lon) > 0.0001 || Math.abs(previous[1] - lat) > 0.0001)) {
            throw Error(`Row ${row}: conflicting coordinates for ${code}.`);
          }
          coordinates.set(code, [lon, lat, code]);
        }
      }
      if (result.origin === result.destination) throw Error(`Row ${row}: origin and destination are the same.`);
      for (const metric of ["flights", "seats"]) result[metric] = number(record[metric], metric, row, 0, 1e12);
      return result;
    });
    for (const route of parsed) for (const end of ["origin", "destination"]) {
      const code = route[end];
      const point = coordinates.get(code) || airports[code];
      if (!point) throw Error(`Unknown airport ${code}: add ${end}_lat and ${end}_lon columns.`);
      coordinates.set(code, point);
    }
    for (const route of parsed) {
      if (great_circle(coordinates.get(route.origin), coordinates.get(route.destination)).length < 2) {
        throw Error(`Route ${route.origin}–${route.destination}: endpoints must have different coordinates and cannot be exactly opposite on Earth.`);
      }
    }
    return { routes: parsed, airports: coordinates };
  }
  const radians = Math.PI / 180;
  function great_circle(a, b, steps = 64) {
    const vector = ([lon, lat]) => [Math.cos(lat * radians) * Math.cos(lon * radians), Math.cos(lat * radians) * Math.sin(lon * radians), Math.sin(lat * radians)];
    const u = vector(a), v = vector(b);
    const angle = Math.acos(Math.max(-1, Math.min(1, u.reduce((s, n, i) => s + n * v[i], 0))));
    if (angle < 1e-8 || Math.PI - angle < 1e-8) return [];
    return Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps, p = u.map((n, j) => (n * Math.sin((1 - t) * angle) + v[j] * Math.sin(t * angle)) / Math.sin(angle));
      return [Math.atan2(p[1], p[0]) / radians, Math.atan2(p[2], Math.hypot(p[0], p[1])) / radians];
    });
  }
  const wrap = (lon, centre) => ((lon - centre + 540) % 360 + 360) % 360 - 180 + centre;
  function fit_extent(points) {
    const lons = points.map(p => ((p[0] % 360) + 360) % 360).sort((a, b) => a - b);
    let gap = -1, start = 0;
    for (let i = 0; i < lons.length; i++) {
      const next = i + 1 < lons.length ? lons[i + 1] : lons[0] + 360;
      if (next - lons[i] > gap) { gap = next - lons[i]; start = next % 360; }
    }
    const span = 360 - gap, centre = start + span / 2;
    const low = points.reduce((v, p) => Math.min(v, p[1]), 90);
    const high = points.reduce((v, p) => Math.max(v, p[1]), -90);
    const xpad = Math.max(3, span * .13), ypad = Math.max(3, (high - low) * .18);
    return [centre - Math.min(360, span + xpad * 2) / 2, centre + Math.min(360, span + xpad * 2) / 2,
      Math.max(-90, low - ypad), Math.min(90, high + ypad)];
  }
  function aggregate(routes, airline = "") {
    const groups = new Map();
    for (const route of routes.filter(r => !airline || r.airline === airline)) {
      const pair = [route.origin, route.destination].sort(), key = pair.join("-");
      if (!groups.has(key)) groups.set(key, { origin: pair[0], destination: pair[1], flights: 0, seats: 0, airlines: new Set() });
      const group = groups.get(key);
      for (const metric of ["flights", "seats"]) group[metric] = group[metric] == null || route[metric] == null ? null : group[metric] + route[metric];
      if (route.airline) group.airlines.add(route.airline);
    }
    return [...groups.values()];
  }
  const api = { airports, MAX_ROWS, parse_csv, normalise, great_circle, fit_extent, wrap, aggregate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RouteMap = api;
})(typeof window !== "undefined" ? window : globalThis);
