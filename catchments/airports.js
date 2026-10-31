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
      : `${people(airport.population_closer_30)} people closer by 30+ minutes, out of ${people(airport.population_study)} in the area shown.`;
    const links = document.createElement("p");
    links.className = "links";
    links.append(link(airport.live, "Live map"), link("airports/" + airport.image, "Image (PNG)", true),
      link("airports/" + airport.areas_csv, "Area data (CSV)", true), link("airports/" + airport.bands_csv, "Bands (CSV)", true));
    li.append(figure, title, note, links);
    return li;
  }

  function show(country) {
    for (const tab of $("countries").querySelectorAll("button")) tab.setAttribute("aria-pressed", tab.value === country);
    for (const group of $("groups").children) group.hidden = group.dataset.country !== country;
    history.replaceState(null, "", `?country=${country.toLowerCase()}`);
  }

  fetch("airports/index.json").then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(index => {
    const countries = Object.keys(COUNTRIES).filter(c => index.airports.some(a => a.country === c));
    for (const country of countries) {
      const tab = document.createElement("button");
      tab.type = "button"; tab.className = "chip"; tab.value = country; tab.textContent = COUNTRIES[country];
      tab.addEventListener("click", () => show(country));
      $("countries").append(tab);
      const group = document.createElement("section");
      group.dataset.country = country;
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
