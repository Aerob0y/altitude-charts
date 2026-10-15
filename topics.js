(() => {
  "use strict";
  const root = new URL("./", document.currentScript.src);
  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "Site navigation");
  const brand = document.createElement("a");
  brand.className = "site-brand";
  brand.href = root.href;
  brand.textContent = "Altitude";
  const topics = document.createElement("details");
  topics.className = "site-topics";
  const summary = document.createElement("summary");
  summary.textContent = "Topics";
  const panel = document.createElement("div");
  panel.className = "site-topics-panel";
  panel.textContent = "Loading topics…";
  topics.append(summary, panel);
  nav.append(brand, topics);
  const old = document.querySelector("body > .bar");
  if (old) old.replaceWith(nav); else document.body.prepend(nav);
  const pagePath = path => path.replace(/index\.html$/, "");
  const current = () => {
    for (const link of panel.querySelectorAll("a")) {
      const url = new URL(link.href);
      if (pagePath(url.pathname) === pagePath(location.pathname) && url.hash === location.hash.split("?")[0]) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  };
  document.addEventListener("click", event => { if (!topics.contains(event.target)) topics.open = false; });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && topics.open) { topics.open = false; summary.focus(); }
  });
  panel.addEventListener("click", event => { if (event.target.closest("a")) topics.open = false; });
  addEventListener("hashchange", current);
  fetch(new URL("index.json", root)).then(response => {
    if (!response.ok) throw Error("Topics unavailable");
    return response.json();
  }).then(index => {
    const charts = index.charts || [];
    const groups = [
      {label: "Aviation", entries: [
        ...(index.tools || []).filter(tool => tool.key !== "route-map-projections").map(tool => ({title: tool.title, path: tool.page})),
        ...charts.filter(chart => chart.menu === "Aviation").map(chart => ({title: chart.title, path: chart.site + "/#" + chart.name}))
      ]},
      ...[{key: "nz", label: "New Zealand"}, {key: "ireland", label: "Ireland"}].map(site => ({
        label: site.label,
        entries: charts.filter(chart => chart.site === site.key && chart.menu !== "Aviation")
          .map(chart => ({title: chart.title, path: chart.site + "/#" + chart.name}))
      }))
    ];
    panel.replaceChildren();
    for (const group of groups) {
      const section = document.createElement("section");
      const heading = document.createElement("h2");
      heading.textContent = group.label;
      const list = document.createElement("ul");
      for (const entry of group.entries) {
        const item = document.createElement("li"), link = document.createElement("a");
        link.href = new URL(entry.path, root).href;
        link.textContent = entry.title;
        item.append(link); list.append(item);
      }
      section.append(heading, list); panel.append(section);
    }
    current();
  }).catch(() => { panel.textContent = "Topics could not load. Please reload the page."; });
})();
