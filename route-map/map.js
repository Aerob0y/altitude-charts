/* Reusable geometry and input validation. No browser or network dependencies. */
(function (root) {
  "use strict";
  const airports = Object.create(null);
  // Preserve familiar labels; the source city field often names a suburb.
  const airport_names = {
    ZQN: "Queenstown", AKL: "Auckland", SYD: "Sydney", MEL: "Melbourne",
    BNE: "Brisbane", OOL: "Gold Coast", CBR: "Canberra", CHC: "Christchurch",
    WLG: "Wellington", DUD: "Dunedin", PER: "Perth", ADL: "Adelaide",
    HBA: "Hobart", CNS: "Cairns", DUB: "Dublin", ORK: "Cork",
    SNN: "Shannon", NOC: "Ireland West", KIR: "Kerry"
  };
  function set_airports(records) {
    for (const key of Object.keys(airports)) delete airports[key];
    for (const record of records) {
      if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) continue;
      const point = [record.lon, record.lat, airport_names[record.code] || String(record.name || record.code || record.icao).replace(/(?: International)? Airport$/i, "")];
      for (const code of [record.code, record.icao]) {
        if (code && !airports[code]) airports[code] = point;
      }
    }
  }
  function parse_routes(text) {
    const table = [['origin', 'destination', 'colour']];
    for (const entry of text.split(/[,\n\r]+/).map(s => s.trim()).filter(Boolean)) {
      const match = entry.match(/^(.*?)(?:\s+(#[0-9a-f]{6}))?$/i);
      const branches = match[1].toUpperCase().split('/');
      const chain = branches.shift().split('-').map(s => s.trim());
      if (chain.length < 2 || [...chain, ...branches].some(code => !/^[A-Z0-9]{3,4}$/.test(code.trim()))) {
        throw Error(`Invalid route: ${entry}. Use AKL-ZQN, chains or AKL-ZQN/SYD with an optional #rrggbb colour.`);
      }
      for (let i = 1; i < chain.length; i++) table.push([chain[i - 1], chain[i], match[2] || '']);
      for (const branch of branches) table.push([chain.at(-2), branch.trim(), match[2] || '']);
    }
    return normalise(table);
  }
  const MAX_ROWS = 2000;
  function png_dpi(bytes, dpi) {
    const chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
    view.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4);
    view.setUint32(8, Math.round(dpi / .0254)); view.setUint32(12, Math.round(dpi / .0254)); chunk[16] = 1;
    let crc = 0xffffffff;
    for (const value of chunk.slice(4, 17)) {
      crc ^= value;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    view.setUint32(17, (crc ^ 0xffffffff) >>> 0);
    let offset = 8, previous = 0;
    const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset < bytes.length) {
      const length = input.getUint32(offset);
      if (String.fromCharCode(...bytes.slice(offset + 4, offset + 8)) === "pHYs") { previous = length + 12; break; }
      offset += length + 12;
    }
    if (!previous) offset = 33;
    const result = new Uint8Array(bytes.length - previous + chunk.length);
    result.set(bytes.slice(0, offset)); result.set(chunk, offset);
    result.set(bytes.slice(offset + previous), offset + chunk.length);
    return result;
  }
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
      const colour = String(record.colour || record.color || "").trim().toLowerCase();
      if (colour && !/^#[0-9a-f]{6}$/.test(colour)) throw Error(`Row ${row}: colour must be #rrggbb.`);
      const result = { colour, airline: String(record.airline || "").trim().slice(0, 100) };
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
    const unknown = [...new Set(parsed.flatMap(r => [r.origin, r.destination]).filter(code => !coordinates.has(code) && !airports[code]))];
    if (unknown.length) throw Error(`Unknown airport codes: ${unknown.join(", ")}. Check IATA/ICAO codes or supply coordinates in an upload.`);
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
  function aggregate(routes, airline = "", colour_by = "single") {
    const groups = new Map();
    for (const route of routes.filter(r => !airline || r.airline === airline)) {
      const pair = [route.origin, route.destination].sort(), key = pair.join("-") + (colour_by === "route" ? "|" + (route.colour || "") : colour_by === "airline" ? "|" + (route.airline || "") : "");
      if (!groups.has(key)) groups.set(key, { origin: pair[0], destination: pair[1], flights: 0, seats: 0, colour: route.colour || "", airline: route.airline || "", airlines: new Set() });
      const group = groups.get(key);
      for (const metric of ["flights", "seats"]) group[metric] = group[metric] == null || route[metric] == null ? null : group[metric] + route[metric];
      if (route.airline) group.airlines.add(route.airline);
    }
    return [...groups.values()];
  }
  const api = { airports, set_airports, parse_routes, png_dpi, MAX_ROWS, parse_csv, normalise, great_circle, fit_extent, wrap, aggregate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RouteMap = api;
})(typeof window !== "undefined" ? window : globalThis);
