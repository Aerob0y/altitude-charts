(() => {
  let options, summary, subtitle, dates, more;
  const narrow = () => innerWidth < 600;
  const wrap = text => {
    const words = String(text).split(/\s+/), lines = [];
    let line = "";
    for (const word of words) {
      if (line.length + word.length > 30 && line) { lines.push(line); line = ""; }
      line += (line ? " " : "") + word;
    }
    if (line) lines.push(line);
    return lines.join("<br>");
  };

  function setup() {
    if (options) return;
    const controls = document.getElementById("controls");
    options = document.createElement("details");
    options.className = "chart-options";
    summary = document.createElement("summary");
    controls.before(options);
    options.append(summary, controls);
    options.open = !narrow();
    options.addEventListener("change", () => updateSummary());
    const note = document.getElementById("note");
    more = document.createElement("button");
    more.type = "button";
    more.className = "note-more";
    more.textContent = "More";
    more.setAttribute("aria-expanded", "false");
    more.setAttribute("aria-controls", "note");
    note.after(more);
    more.addEventListener("click", () => {
      const expanded = note.classList.toggle("expanded");
      more.textContent = expanded ? "Less" : "More";
      more.setAttribute("aria-expanded", String(expanded));
    });
    subtitle = document.createElement("p");
    subtitle.className = "chart-subtitle";
    dates = document.createElement("div");
    dates.className = "chart-dates";
    dates.setAttribute("role", "group");
    dates.setAttribute("aria-label", "Date range");
    const area = document.querySelector(".chart-area");
    area.before(subtitle, dates);
    let wasNarrow = narrow();
    window.addEventListener("resize", () => {
      if (wasNarrow !== narrow()) { wasNarrow = narrow(); options.open = !wasNarrow; }
      updateSummary();
    });
  }

  function updateSummary() {
    const controls = document.getElementById("controls");
    options.hidden = controls.hidden;
    const series = controls.querySelector(".series-button");
    const chosen = series ? series.textContent.replace(/^Series: /, "").replace(/ ▾$/, "")
      : [...controls.querySelectorAll("select")].filter(select => !select.hidden && select.value !== "")
        .flatMap(select => [...select.selectedOptions].map(option => option.textContent)).join(", ");
    summary.textContent = "Chart options: " + chosen;
    summary.title = chosen;
    const note = document.getElementById("note");
    more.hidden = !narrow() || (!note.classList.contains("expanded") && note.scrollHeight <= note.clientHeight + 1);
  }

  function prepare(chart, spec, layout) {
    setup();
    updateSummary();
    chart._altitudeExportTitle = structuredClone(spec.layout?.title);
    chart._altitudeExportSelector = structuredClone(spec.layout?.xaxis?.rangeselector);
    chart._altitudeSeriesNames = spec.data.filter(trace => trace.mode !== "text").map(trace => trace.name || "series");
    if (!narrow()) return {data: spec.data, layout};
    const title = typeof spec.layout?.title === "string" ? spec.layout.title : spec.layout?.title?.text || "";
    const parts = title.split(/<br\s*\/?\s*>/i);
    subtitle.textContent = new DOMParser().parseFromString(parts.slice(1).join(" "), "text/html").body.textContent;
    layout.title = {text: ""};
    const numericXAxis = ["linear", "category"].includes(layout.xaxis?.type);
    layout.margin = {...layout.margin, t: 12, l: 45, r: layout.yaxis2 ? 45 : 18, b: numericXAxis ? 135 : 100};
    for (const key of Object.keys(layout).filter(key => /^[xy]axis\d*$/.test(key))) {
      layout[key].tickfont = {...layout[key].tickfont, size: 10};
      if (layout[key].title) {
        const title = typeof layout[key].title === "string" ? {text: layout[key].title} : layout[key].title;
        layout[key].title = {...title, standoff: 4, font: {...title.font, size: 12}};
      }
    }
    layout.showlegend = true;
    layout.legend = {...layout.legend, orientation: "h", x: 0, xanchor: "left", y: numericXAxis ? -0.32 : -0.16, yanchor: "top", font: {...layout.legend?.font, size: 10}};
    layout.hoverlabel = {...layout.hoverlabel, namelength: -1};
    const data = spec.data.filter(trace => trace.mode !== "text").map(trace => ({...structuredClone(trace),
      name: wrap(trace.name || ""), showlegend: true, hoverlabel: {...trace.hoverlabel, namelength: -1}}));
    dates.replaceChildren();
    const rangeButtons = numericXAxis ? [] : spec.layout?.xaxis?.rangeselector?.buttons || [];
    if (layout.xaxis?.rangeselector) layout.xaxis.rangeselector.visible = false;
    rangeButtons.forEach(setting => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = setting.label || setting.step;
      button.addEventListener("click", async () => {
        if (!chart._phoneDateHandler) {
          chart._phoneDateHandler = event => {
            if (Object.keys(event).some(key => /^xaxis\.(range|autorange)/.test(key))) {
              dates.querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", "false"));
            }
          };
          chart.on("plotly_relayout", chart._phoneDateHandler);
        }
        if (setting.step === "all") await Plotly.relayout(chart, {"xaxis.autorange": true});
        else {
          const values = data.flatMap(trace => (trace.x || []).map(value => Date.parse(value))).filter(Number.isFinite);
          if (!values.length) return;
          const end = new Date(values.reduce((max, value) => Math.max(max, value), -Infinity));
          const start = new Date(end);
          if (setting.step === "year") start.setUTCFullYear(start.getUTCFullYear() - (setting.count || 1));
          else if (setting.step === "month") start.setUTCMonth(start.getUTCMonth() - (setting.count || 1));
          else if (setting.step === "day") start.setUTCDate(start.getUTCDate() - (setting.count || 1));
          if (setting.stepmode === "todate") {
            start.setTime(end.getTime());
            if (setting.step === "year") start.setUTCMonth(0, 1);
            if (setting.step === "month") start.setUTCDate(1);
          }
          await Plotly.relayout(chart, {"xaxis.range": [start.toISOString(), end.toISOString()], "xaxis.autorange": false});
        }
        dates.querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      });
      dates.append(button);
    });
    return {data, layout};
  }
  window.AltitudePhone = {prepare};
})();
