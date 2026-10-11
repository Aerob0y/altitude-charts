// Combines single-series chart specs into one chart, following standard_plot():
// colours come from the palette in pick order; the first series' unit goes on the
// left axis and any other unit on the right; with two axes each axis takes the
// colour of its first line and is titled with its unit, the legend replaces the
// end labels; with one axis it is black.
(() => {
  function rgba(hex, alpha) {
    const n = parseInt(String(hex).replace("#", ""), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha.toFixed(3)})`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
  }

  // Same wording as short_title() in standards.r.
  function shortTitle(items) {
    if (items.length < 3) return items.join(" and ");
    return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
  }

  function recolour(trace, colour) {
    if (trace.mode === "text") trace.textfont = {...trace.textfont, color: colour};
    else if (trace.type === "bar") trace.marker = {...trace.marker, color: colour};
    else {
      trace.line = {...trace.line, color: colour};
      if (trace.fillcolor) trace.fillcolor = rgba(colour, 0.2);
    }
  }

  // Nudge end labels on the same axis apart when they are closer than 3% of its range.
  function spaceLabels(lines, labels) {
    for (const axis of ["y", "y2"]) {
      const values = lines.filter(t => t.yaxis === axis).flatMap(t => t.y || []).filter(Number.isFinite);
      const mine = labels.filter(t => t.yaxis === axis).sort((a, b) => a.y[0] - b.y[0]);
      if (!values.length || mine.length < 2) continue;
      const gap = (Math.max(...values) - Math.min(...values)) * 0.03;
      for (let i = 0; i < mine.length - 1; i++) {
        if (mine[i + 1].y[0] - mine[i].y[0] < gap) {
          mine[i].textposition = "bottom right";
          mine[i + 1].textposition = "top right";
        }
      }
    }
  }

  const titleOf = (axis, text) => ({...(typeof axis?.title === "object" ? axis.title : {}), text});

  function viewSpec(source, view) {
    if (view.location === undefined) return source;
    const spec = structuredClone(source);
    const packed = spec.location_data;
    const values = packed.values[view.location];
    const last = values.findLastIndex(Number.isFinite);
    spec.data.forEach(trace => {
      trace.name = view.label;
      if (trace.mode === "text") {
        trace.x = [packed.dates[last]];
        trace.y = [values[last]];
        trace.text = view.label;
      } else {
        trace.x = packed.dates;
        trace.y = values;
      }
    });
    spec.layout.title.text = `<b>Rental market</b><br>${escapeHtml(view.subtitle)}: ${escapeHtml(view.label)}`;
    delete spec.location_data;
    return spec;
  }

  function combine(specs, pick, chosen, labels) {
    const palette = pick.palette;
    labels = pick.items || labels;
    const dims = chosen.map(i => pick.dims[i]);
    const axes = dims.map(dim => dim === dims[0] ? "y" : "y2");
    const twoAxes = axes.includes("y2");
    const lines = [], endLabels = [];
    // Views can share a series name (e.g. a value and its % change); then name them by view.
    const names = specs.map(spec => spec.data.find(trace => trace.mode !== "text")?.name);
    const clash = new Set(names).size < names.length;
    specs.forEach((spec, k) => {
      for (const source of spec.data) {
        const trace = structuredClone(source);
        trace.yaxis = axes[k];
        trace.legendgroup = "series_" + (k + 1);
        recolour(trace, palette[k % palette.length]);
        if (clash) {
          trace.name = labels[chosen[k]];
          if (trace.mode === "text") trace.text = trace.name;
        }
        // Plotly specs store a lone end label's y as a number.
        if (trace.mode === "text") {
          if (twoAxes) continue;
          if (!Array.isArray(trace.y)) trace.y = [trace.y];
          if (!Array.isArray(trace.x)) trace.x = [trace.x];
          endLabels.push(trace);
        } else lines.push(trace);
      }
    });
    spaceLabels(lines, endLabels);

    const layout = structuredClone(specs[0].layout || {});
    const second = axes.indexOf("y2");
    layout.yaxis = {...layout.yaxis, color: twoAxes ? palette[0] : "black", zerolinecolor: "black"};
    if (twoAxes) {
      layout.yaxis.title = titleOf(layout.yaxis, dims[0]);
      const from = specs[second].layout.yaxis || {};
      layout.yaxis2 = {
        ...(layout.yaxis2 || {}), overlaying: "y", side: "right", anchor: "x", showgrid: false,
        rangemode: "tozero", automargin: true, zerolinecolor: "black",
        tickformat: from.tickformat, tickprefix: from.tickprefix, color: palette[second % palette.length],
        title: titleOf(layout.yaxis2, dims[second])
      };
      layout.showlegend = true;
      layout.margin = {...layout.margin, r: pick.margin_r};
    } else {
      delete layout.yaxis2;
      layout.margin = {...layout.margin, r: Math.max(...specs.map(spec => spec.layout?.margin?.r || 0))};
    }
    layout.title = {...layout.title, text: `<b>${escapeHtml(pick.title)}</b><br><span style='font-size:0.8em; color:gray;'>` +
      `${escapeHtml(pick.subtitles?.[chosen[0]] || pick.subtitle)}: ${escapeHtml(shortTitle(chosen.map(i => labels[i])))}` +
      `${pick.groups && !pick.subtitles ? escapeHtml(` (${pick.group_names?.[pick.groups[chosen[0]]] || pick.groups[chosen[0]]})`) : ""}</span>`};
    return {data: [...lines, ...endLabels], layout, config: specs[0].config};
  }

  const setupListeners = new WeakMap();

  // Keep tick order: the first chosen series sets the left axis.
  function setup(container, manifest, requested, onChange) {
    const pick = manifest.pick, dims = pick.dims, groups = pick.groups;
    const names = pick.items || manifest.views.map(view => view.label);
    const slugs = manifest.views.map(view => view.id || view.spec.replace(/\.json$/i, "").split("/").pop());
    const groupOf = i => groups ? groups[i] : "";
    const twoUnits = picks => picks.filter((i, k) => new Set(picks.slice(0, k + 1).map(j => dims[j])).size <= 2);
    let chosen = [...new Set(requested.map(slug => slugs.indexOf(slug)).filter(i => i >= 0))];
    chosen = twoUnits(chosen.filter(i => groupOf(i) === groupOf(chosen[0]))).slice(0, pick.labels.length);
    if (!chosen.length) chosen = [...(pick.default || [0])];

    container.replaceChildren();
    setupListeners.get(container)?.abort();
    const listeners = new AbortController();
    setupListeners.set(container, listeners);
    const addSelect = (id, label) => {
      const select = document.createElement("select");
      select.id = id;
      const text = document.createElement("label");
      text.htmlFor = id;
      text.textContent = label;
      container.append(text, select);
      return select;
    };
    const groupSelect = groups && addSelect("pick-group", pick.group_label || "Group");
    const groupNames = pick.group_names || {};
    if (groupSelect) [...new Set([...Object.keys(groupNames), ...groups])].filter(group => groups.includes(group))
      .forEach(group => groupSelect.append(new Option(groupNames[group] || group, group)));
    const dropdown = document.createElement("span");
    dropdown.className = "series-picker";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "series-button";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "series-options");
    const panel = document.createElement("span");
    panel.id = "series-options";
    panel.className = "series-options";
    panel.hidden = true;
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Choose series");
    const hint = document.createElement("span");
    hint.className = "series-hint";
    hint.id = "series-hint";
    hint.textContent = `Tick up to ${pick.labels.length}. First tick sets the left axis.`;
    panel.setAttribute("aria-describedby", hint.id);
    panel.append(hint);
    const headings = [];
    const options = names.map((name, i) => {
      const category = pick.item_categories?.[i];
      if (category && (category !== pick.item_categories[i - 1] || groupOf(i) !== groupOf(i - 1))) {
        const heading = document.createElement("strong");
        heading.textContent = category;
        heading.style.display = "block";
        panel.append(heading);
        headings.push({heading, group: groupOf(i)});
      }
      const row = document.createElement("label");
      row.className = "series-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = String(i);
      row.append(input, document.createTextNode(name));
      panel.append(row);
      input.addEventListener("change", () => {
        chosen = input.checked ? [...chosen, i] : chosen.filter(j => j !== i);
        changed();
      });
      return {row, input};
    });
    dropdown.append(button, panel);
    container.append(dropdown);
    const open = value => {
      panel.hidden = !value;
      button.setAttribute("aria-expanded", String(value));
    };
    button.addEventListener("click", () => open(panel.hidden));
    button.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        open(true);
        options.find(({row, input}) => !row.hidden && !input.disabled)?.input.focus();
      }
    });
    dropdown.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.stopPropagation();
        open(false);
        button.focus();
      }
    });
    document.addEventListener("click", event => {
      if (!dropdown.contains(event.target)) open(false);
    }, {signal: listeners.signal});
    // Tabbing away closes the list. A click on a row's text moves focus to nothing
    // (relatedTarget null), so leave that to the outside-click listener.
    dropdown.addEventListener("focusout", event => {
      if (event.relatedTarget && !dropdown.contains(event.relatedTarget)) open(false);
    });

    const fill = () => {
      const group = groupOf(chosen[0]);
      if (groupSelect) groupSelect.value = group;
      headings.forEach(({heading, group: mine}) => { heading.hidden = mine !== group; heading.style.display = mine === group ? "block" : "none"; });
      button.textContent = "Series: " + chosen.map(i => names[i]).join(", ") + " ▾";
      const units = new Set(chosen.map(i => dims[i]));
      options.forEach(({row, input}, i) => {
        row.hidden = groupOf(i) !== group;
        input.checked = chosen.includes(i);
        const reason = input.checked ? (chosen.length === 1 ? "Keep at least one series selected." : "")
          : units.size === 2 && !units.has(dims[i]) ? "Only two units can share a chart. Untick a series to change units."
          : chosen.length >= pick.labels.length ? `Tick up to ${pick.labels.length} series. Untick one to add another.` : "";
        input.disabled = Boolean(reason);
        row.title = reason;
        input.title = reason;
        row.classList.toggle("disabled", Boolean(reason));
      });
    };
    const changed = () => {
      fill();
      onChange([...chosen], chosen.map(i => slugs[i]));
    };
    // A new group keeps the same items where the group has them.
    groupSelect?.addEventListener("change", () => {
      const group = groupSelect.value;
      const inGroup = names.map((_, i) => i).filter(i => groups[i] === group);
      const kept = chosen.map(i => inGroup.find(j => names[j] === names[i])).filter(i => i !== undefined);
      chosen = twoUnits(kept.length ? kept : inGroup.slice(0, 1));
      changed();
    });
    fill();
    return chosen;
  }

  window.AltitudePick = {combine, setup, viewSpec};
})();
