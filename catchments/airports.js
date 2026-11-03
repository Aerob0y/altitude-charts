// Airport catchment map index (Beta). Lists airports/index.json, written by
// dev/build_catchment_maps.R, with links to each map image, its data and the live map.
(() => {
  const $ = id => document.getElementById(id);
  const COUNTRIES = { NZ: "New Zealand", AU: "Australia", IE: "Ireland" };
  const people = n => Math.round(n).toLocaleString("en-NZ");

  function link(href, text, download) {
    const a = document.createElement("a");
    a.href = href; a.textContent = text;
    if (download) a.setAttribute("download", "");
    return a;
  }

  function card(airport) {
    const li = document.createElement("li");
    const figure = document.createElement("a");
    figure.className = "thumb"; figure.href = "airports/" + airport.image;
    const img = document.createElement("img");
    img.src = "airports/" + airport.thumb; img.alt = `Map of where ${airport.name} is the closest airport`;
    img.width = 480; img.height = 360; img.loading = "lazy";
    figure.append(img);
    const title = document.createElement("h3");
    title.textContent = `${airport.name} (${airport.code})`;
    const note = document.createElement("p");
    note.textContent = airport.no_rival
      ? `No other major airport within two hours. ${people(airport.population_study)} people in the area shown.`
      : `${people(airport.population_closer)} people live closer to ${airport.code} than to any rival, out of ${people(airport.population_study)} in the area shown.`;
    // Cut-off maps exist only for airports with a rival, and only once the maps are rebuilt.
    const extra = [30, 60].map(minutes => (airport.cutoffs || []).find(c => c.minutes === minutes)).filter(Boolean);
    const cutoffs = document.createElement("p");
    if (extra.length) cutoffs.textContent = extra.map(c => airport.major
      ? `${c.minutes} min head start: ${people(c.population_closer)}.`
      : `At least ${c.minutes} min closer: ${people(c.population_closer)}.`).join(" ");
    const links = document.createElement("p");
    links.className = "links";
    links.append(link(airport.live, "Live map"), link("airports/" + airport.image, "Image (PNG)", true),
      link("airports/" + airport.areas_csv, "Area data (CSV)", true), link("airports/" + airport.bands_csv, "Bands (CSV)", true));
    for (const c of extra) links.append(link("airports/" + c.image, `Map at ${c.minutes} min`, true), link(c.live, `Live map at ${c.minutes} min`));
    li.append(figure, title, note, ...(extra.length ? [cutoffs] : []), links);
    return li;
  }

  function countryPanel(country) {
    const records = Array.isArray(index.countries) ? index.countries : Object.values(index.countries || {});
    const record = records.find(item => item.country === country);
    if (!record || !record.cutoffs || !record.cutoffs.length) return null;
    const panel = document.createElement("section");
    panel.className = "country-map";
    const heading = document.createElement("h2"); heading.textContent = "Whole country";
    const figure = document.createElement("figure");
    const image = document.createElement("img"); image.loading = "lazy"; image.width = 1920; image.height = 1440;
    const body = document.createElement("div"); body.className = "country-map-body";
    const airportList = document.createElement("aside"); airportList.className = "country-airports";
    airportList.setAttribute("aria-label", `${record.name} airport catchment populations`);
    const controls = document.createElement("p"); controls.className = "country-map-controls";
    const downloads = document.createElement("p"); downloads.className = "links";
    const update = cutoff => {
      image.src = "airports/" + cutoff.image;
      image.alt = cutoff.contested ? `${record.name}: where regional and major airports compete` :
        `${record.name} airport catchments with a ${cutoff.minutes}-minute cut-off`;
      controls.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed",
        String(button.value === (cutoff.contested ? "contested" : String(cutoff.minutes)))));
      downloads.replaceChildren(link("airports/" + cutoff.image, "Image (PNG)", true), link("airports/" + cutoff.areas_csv, "Area data (CSV)", true));
      airportList.replaceChildren();
      const airports = index.airports.filter(a => a.country === country);
      const figures = cutoff.airports || [];
      for (const [label, major] of [["Major airports", true], ["Regional airports", false]]) {
        const heading = document.createElement("h3"); heading.textContent = label;
        const list = document.createElement("ul");
        for (const entry of figures.filter(a => Boolean(a.major) === major)) {
          const airport = airports.find(a => a.code === entry.code);
          const params = new URLSearchParams({country: country.toLowerCase(), airport: entry.code,
            style: "advantage", threshold: cutoff.minutes,
            rivals: airports.filter(a => a.code !== entry.code).map(a => a.code).join(",")});
          const row = document.createElement("li");
          const a = link("index.html?" + params, `${entry.code} ${airport?.name || entry.code}`);
          const population = document.createElement("span");
          population.textContent = entry.population > 0 ? people(entry.population) : "–";
          a.append(population); row.append(a); list.append(row);
        }
        if (list.childElementCount) airportList.append(heading, list);
      }
    };
    const choices = [...record.cutoffs];
    if (record.contested_image) choices.unshift({contested: true, minutes: 0, image: record.contested_image,
      areas_csv: record.contested_areas_csv, airports: record.cutoffs.find(c => c.minutes === 0)?.airports});
    for (const cutoff of choices) {
      const button = document.createElement("button"); button.type = "button"; button.className = "chip";
      button.value = cutoff.contested ? "contested" : cutoff.minutes;
      button.textContent = cutoff.contested ? "Contested" : `${cutoff.minutes} min`;
      button.addEventListener("click", () => update(cutoff)); controls.append(button);
    }
    update(choices[0]); figure.append(image); body.append(figure, airportList);
    panel.append(heading, controls, body, downloads);
    return panel;
  }

  function show(country) {
    for (const tab of $("countries").querySelectorAll("button")) tab.setAttribute("aria-pressed", tab.value === country);
    for (const group of $("groups").children) group.hidden = group.dataset.country !== country;
    history.replaceState(null, "", `?country=${country.toLowerCase()}`);
  }

  let index;
  fetch("airports/index.json").then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(loaded => {
    index = loaded;
    const countries = Object.keys(COUNTRIES).filter(c => index.airports.some(a => a.country === c));
    for (const country of countries) {
      const tab = document.createElement("button");
      tab.type = "button"; tab.className = "chip"; tab.value = country; tab.textContent = COUNTRIES[country];
      tab.addEventListener("click", () => show(country));
      $("countries").append(tab);
      const group = document.createElement("section");
      group.dataset.country = country;
      const wholeCountry = countryPanel(country);
      if (wholeCountry) group.append(wholeCountry);
      for (const [label, major] of [["Major airports", true], ["Regional airports", false]]) {
        const list = index.airports.filter(a => a.country === country && Boolean(a.major) === major);
        if (!list.length) continue;
        const heading = document.createElement("h2");
        heading.textContent = label;
        const grid = document.createElement("ul");
        grid.className = "airport-grid";
        grid.append(...list.map(card));
        group.append(heading, grid);
      }
      $("groups").append(group);
    }
    $("status").textContent = `${index.airports.length} airports. Maps built ${index.updated}.`;
    const wanted = (new URLSearchParams(location.search).get("country") || "").toUpperCase();
    show(countries.includes(wanted) ? wanted : countries[0]);
  }).catch(() => { $("status").textContent = "The airport list could not be loaded. Please try again later."; });
})();
