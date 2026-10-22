// Pure logic for the Auckland homes map. Loads in the browser (window.Donut) and in Node.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Donut = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const BRITOMART = [174.7680, -36.8442];
  const TYPE_LABELS = {houses: "Houses", townhouses: "Townhouses, flats and units", apartments: "Apartments", retirement: "Retirement village units"};

  // Homes consented in each area from January of `from` to December of `to` (default: the latest month), by type.
  function consentsSince(data, area, from, to = data.years[data.years.length - 1]) {
    const start = data.years.indexOf(from), end = data.years.indexOf(to);
    if (start < 0) throw new Error("No consent data for " + from);
    if (end < start) throw new Error("No consent data for " + to);
    const byType = data.types.map(() => 0);
    for (let i = start; i <= end; i++) {
      area.consents[i].forEach((value, j) => { byType[j] += value; });
    }
    return {total: byType.reduce((a, b) => a + b, 0), byType};
  }

  // One row per area for the chosen settings. mode: "homes" or "growth"; measure: "total" or "hectare".
  function rows(data, settings) {
    const {from, to, mode = "homes", measure = "total", urbanOnly = false} = settings;
    const baseline = mode === "growth" ? "pop_2013" : "pop_2023";
    return data.areas
      .filter(area => !urbanOnly || area.urban)
      .filter(area => area.land_ha > 0 || area[baseline] > 0)
      .map(area => {
        const homes = consentsSince(data, area, from, to);
        const people = area[baseline];
        const outcome = mode === "growth" ? area.growth_2013_2023 : homes.total;
        const per = value => (measure === "hectare" ? (area.land_ha > 0 ? value / area.land_ha : 0) : value);
        return {
          code: area.sa2_code, name: area.sa2_name, urban: area.urban, lon: area.lon, lat: area.lat,
          dist_km: area.dist_km, land_ha: area.land_ha, pop_2013: area.pop_2013, pop_2023: area.pop_2023,
          growth: area.growth_2013_2023, homes: homes.total, homes_by_type: homes.byType,
          people_value: per(people), outcome_value: per(outcome),
          per_100: people >= 100 ? 100 * homes.total / area.pop_2023 : null
        };
      });
  }

  // Distance by which half of the total is reached, ordered by distance from Britomart.
  function halfDistance(list, key) {
    const ordered = [...list].sort((a, b) => a.dist_km - b.dist_km);
    const total = ordered.reduce((sum, row) => sum + row[key], 0);
    if (total <= 0) return null;
    let running = 0;
    for (const row of ordered) {
      running += row[key];
      if (running >= total / 2) return row.dist_km;
    }
    return null;
  }

  function summary(data, settings) {
    const list = rows(data, {...settings, measure: "total"});
    const people = settings.mode === "growth" ? "pop_2013" : "pop_2023";
    const outcome = settings.mode === "growth" ? "growth" : "homes";
    return {
      areas: list.length,
      people: list.reduce((sum, row) => sum + row[people], 0),
      outcome: list.reduce((sum, row) => sum + row[outcome], 0),
      people_half_km: halfDistance(list, people),
      outcome_half_km: halfDistance(list, outcome)
    };
  }

  // 2 km distance bands from Britomart, matching the R analysis (left-closed, last band open).
  const BAND_LABELS = Array.from({length: 15}, (_, i) => `${2 * i}-${2 * i + 2}`).concat("30+");
  const bandOf = km => BAND_LABELS[Math.min(15, Math.floor(km / 2))];

  // Census figures per area for the three story steps. Rates need at least 100 residents in 2013.
  function storyRows(data, {urbanOnly = true} = {}) {
    const list = data.areas
      .filter(area => !urbanOnly || area.urban)
      .filter(area => area.land_ha > 0 || area.pop_2013 > 0);
    const residents = list.reduce((sum, area) => sum + area.pop_2013, 0);
    const added = list.reduce((sum, area) => sum + area.growth_2013_2023, 0);
    return list.map(area => ({
      code: area.sa2_code, name: area.sa2_name, urban: area.urban, lon: area.lon, lat: area.lat,
      dist_km: area.dist_km, band: bandOf(area.dist_km), land_ha: area.land_ha,
      pop_2013: area.pop_2013, pop_2023: area.pop_2023, growth: area.growth_2013_2023,
      density_2013: area.land_ha > 0 ? area.pop_2013 / area.land_ha : 0,
      density_2023: area.land_ha > 0 ? area.pop_2023 / area.land_ha : 0,
      residents_share: residents > 0 ? area.pop_2013 / residents : 0,
      added_share: added !== 0 ? area.growth_2013_2023 / added : 0,
      growth_a_year: area.pop_2013 >= 100 ? growthAYear(area.pop_2013, area.pop_2023) : null
    }));
  }

  function growthAYear(from, to, years = 10) {
    return from > 0 ? Math.pow(to / from, 1 / years) - 1 : null;
  }

  // Totals for a set of story rows: residents, people added, density, shares and growth a year.
  function totals(list, all = list) {
    const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
    const pop_2013 = sum(list, "pop_2013"), pop_2023 = sum(list, "pop_2023"), land_ha = sum(list, "land_ha");
    const added = pop_2023 - pop_2013;
    const allAdded = sum(all, "pop_2023") - sum(all, "pop_2013");
    return {
      areas: list.length, pop_2013, pop_2023, added, land_ha,
      density_2013: land_ha > 0 ? pop_2013 / land_ha : null,
      density_2023: land_ha > 0 ? pop_2023 / land_ha : null,
      residents_share: pop_2013 / sum(all, "pop_2013"),
      added_share: allAdded !== 0 ? added / allAdded : null,
      growth_a_year: growthAYear(pop_2013, pop_2023)
    };
  }

  // One row of totals per 2 km band, like the charts.
  function bands(list) {
    return BAND_LABELS.map(band => ({band, ...totals(list.filter(row => row.band === band), list)}));
  }

  // The groups the story compares: the centre, the inner suburbs and the outer edge.
  const GROUPS = {centre: [0, 2], inner: [2, 6], middle: [6, 18], outer: [18, Infinity]};
  function groups(list) {
    return Object.fromEntries(Object.entries(GROUPS).map(([key, [low, high]]) =>
      [key, totals(list.filter(row => row.dist_km >= low && row.dist_km < high), list)]));
  }

  function annulus(inner, outer, steps = 96) {
    return inner > 0 ? [ring(outer, steps), ring(inner, steps).reverse()] : [ring(outer, steps)];
  }

  // A round number of units per kilometre of bar height, so the tallest bar is about `target_km` high.
  function niceStep(max, target_km = 4) {
    if (!(max > 0)) return 1;
    const raw = max / target_km;
    const power = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].find(m => m * power >= raw) * power;
    return step;
  }

  function quantile(values, q) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  }

  // Shift each pair of bars east and west of the area's point so both show.
  function offset(lon, lat, metres) {
    return [lon + metres / (111320 * Math.cos(lat * Math.PI / 180)), lat];
  }

  function ring(km, steps = 96) {
    const [lon, lat] = BRITOMART;
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const angle = 2 * Math.PI * i / steps;
      points.push([lon + km * Math.sin(angle) / (111.32 * Math.cos(lat * Math.PI / 180)), lat + km * Math.cos(angle) / 110.574]);
    }
    return points;
  }

  function format(value, digits = 0) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "–";
    return value.toLocaleString("en-NZ", {minimumFractionDigits: digits, maximumFractionDigits: digits});
  }

  function monthLabel(iso) {
    const [year, month] = iso.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-NZ", {month: "long", year: "numeric", timeZone: "UTC"});
  }

  return {BRITOMART, TYPE_LABELS, BAND_LABELS, GROUPS, bandOf, storyRows, growthAYear, totals, bands, groups, annulus,
    consentsSince, rows, halfDistance, summary, niceStep, quantile, offset, ring, format, monthLabel};
});
