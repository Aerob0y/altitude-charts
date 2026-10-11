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

  function combine(specs, pick, chosen, labels) {
    const palette = pick.palette;
    const dims = chosen.map(i => pick.dims[i]);
    const axes = dims.map(dim => dim === dims[0] ? "y" : "y2");
    const twoAxes = axes.includes("y2");
    const lines = [], endLabels = [];
    specs.forEach((spec, k) => {
      for (const source of spec.data) {
        const trace = structuredClone(source);
        trace.yaxis = axes[k];
        trace.legendgroup = "series_" + (k + 1);
        recolour(trace, palette[k % palette.length]);
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
    layout.yaxis = {...layout.yaxis, color: twoAxes ? palette[0] : "black"};
    if (twoAxes) {
      layout.yaxis.title = titleOf(layout.yaxis, dims[0]);
      const from = specs[second].layout.yaxis || {};
      layout.yaxis2 = {
        ...(layout.yaxis2 || {}), overlaying: "y", side: "right", anchor: "x", showgrid: false,
        rangemode: "tozero", automargin: true,
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
      `${escapeHtml(pick.subtitle)}: ${escapeHtml(shortTitle(chosen.map(i => labels[i])))}</span>`};
    return {data: [...lines, ...endLabels], layout, config: specs[0].config};
  }

  window.AltitudePick = {combine};
})();
