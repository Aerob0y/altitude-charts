(() => {
  "use strict";
  const root = new URL("./", document.currentScript.src);
  // The CSV site header, so chart pages and the site's own pages read as one site.
  const nav = document.createElement("header");
  nav.className = "site-nav";
  const brand = document.createElement("a");
  brand.className = "site-brand";
  brand.href = root.href;
  brand.setAttribute("aria-label", "CSV Consulting home");
  const logo = document.createElement("img");
  logo.src = new URL("images/csv-logo-ink.png", root).href;
  logo.alt = "CSV";
  logo.width = 299; logo.height = 236;
  brand.append(logo);
  const links = document.createElement("nav");
  links.className = "site-links";
  links.id = "site-links";
  links.setAttribute("aria-label", "Main");
  for (const [href, text] of [["work.html", "Selected work"], ["insights.html", "Insights"], ["posts.html", "Posts"],
    ["about.html", "About"], ["contact.html", "Discuss a project"]]) {
    const link = document.createElement("a");
    link.href = new URL(href, root).href;
    link.textContent = text;
    if (href === "insights.html") link.setAttribute("aria-current", "true");
    if (href === "contact.html") link.className = "site-cta";
    links.append(link);
  }
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "site-menu";
  toggle.setAttribute("aria-controls", "site-links");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Open menu");
  toggle.innerHTML = "<span></span><span></span><span></span>";
  const setMenu = open => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    nav.classList.toggle("menu-open", open);
  };
  toggle.addEventListener("click", () => setMenu(!nav.classList.contains("menu-open")));
  const topics = document.createElement("details");
  topics.className = "site-topics";
  const summary = document.createElement("summary");
  summary.textContent = "Chart topics";
  const panel = document.createElement("div");
  panel.className = "site-topics-panel";
  panel.textContent = "Loading topics…";
  topics.append(summary, panel);
  nav.append(brand, topics, links, toggle);
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
  document.addEventListener("click", event => {
    if (!topics.contains(event.target)) topics.open = false;
    if (!nav.contains(event.target)) setMenu(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && topics.open) { topics.open = false; summary.focus(); }
    if (event.key === "Escape" && nav.classList.contains("menu-open")) { setMenu(false); toggle.focus(); }
  });
  topics.addEventListener("toggle", () => { if (topics.open) setMenu(false); });
  panel.addEventListener("click", event => { if (event.target.closest("a")) topics.open = false; });
  addEventListener("hashchange", current);
  fetch(new URL("index.json", root)).then(response => {
    if (!response.ok) throw Error("Topics unavailable");
    return response.json();
  }).then(index => {
    const charts = (index.charts || []).filter(chart => !chart.wip);
    const groups = [
      {label: "Aviation", entries: [
        ...(index.tools || []).filter(tool => tool.key !== "route-map-projections" && tool.section !== "miscellaneous").map(tool => ({title: tool.title, path: tool.page})),
        ...charts.filter(chart => chart.menu === "Aviation").map(chart => ({title: chart.title, path: chart.site + "/#" + chart.name}))
      ]},
      ...[{key: "nz", label: "New Zealand"}, {key: "ireland", label: "Ireland"}].map(site => ({
        label: site.label,
        entries: charts.filter(chart => chart.site === site.key && chart.menu !== "Aviation")
          .map(chart => ({title: chart.title, path: chart.site + "/#" + chart.name}))
      })),
      {label: "Miscellaneous", entries: [
        ...(index.tools || []).filter(tool => tool.section === "miscellaneous").map(tool => ({title: tool.title, path: tool.page})),
        ...charts.filter(chart => chart.site === "miscellaneous").map(chart => ({title: chart.title, path: "miscellaneous/#" + chart.name}))
      ]}
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
