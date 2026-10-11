// One calculation for the dashboard and published charts.
(() => {
  const handlers = new WeakMap();
  const dateValue = value => typeof value === "number" ? value : Date.parse(value);

  function ranges(data, window) {
    const bounds = [[0, 0], [0, 0]], counts = [0, 0];
    const dates = window?.map(dateValue);
    for (const trace of data) {
      if (trace.mode === "text" || trace.visible === false || trace.visible === "legendonly") continue;
      const axis = trace.yaxis === "y2" ? 1 : 0;
      (trace.y || []).forEach((value, i) => {
        if (!Number.isFinite(value)) return;
        const date = dateValue(trace.x?.[i]);
        if (dates && (date < dates[0] || date > dates[1] || !Number.isFinite(date))) return;
        bounds[axis][0] = Math.min(bounds[axis][0], value);
        bounds[axis][1] = Math.max(bounds[axis][1], value);
        counts[axis]++;
      });
    }
    if (counts.some(count => !count)) return null;
    const padded = bounds.map(([min, max]) => {
      const padding = (max - min || 1) * 0.05;
      return [min < 0 ? min - padding : 0, max + padding];
    });
    const share = Math.max(...padded.map(([min, max]) => -min / (max - min)));
    return padded.map(([min, max]) => {
      const span = Math.max(share ? -min / share : 0, max / (1 - share));
      return [-share * span, (1 - share) * span];
    });
  }

  async function attach(chart, plotly) {
    const old = handlers.get(chart);
    if (old) {
      chart.removeListener("plotly_relayout", old.relayout);
      chart.removeListener("plotly_restyle", old.restyle);
    }
    handlers.delete(chart);
    if (!chart.layout?.yaxis2 || !chart.data?.some(trace => trace.yaxis === "y2")) return;
    const align = async () => {
      const xaxis = chart._fullLayout?.xaxis;
      const result = ranges(chart.data, xaxis?.type === "date" ? xaxis.range : null);
      if (!result) return;
      const updates = {};
      for (const [i, key] of ["yaxis", "yaxis2"].entries()) {
        const current = chart.layout[key]?.range;
        if (chart.layout[key]?.autorange !== false || !current || result[i].some((v, j) => Math.abs(v - current[j]) > 1e-9)) {
          updates[key + ".range"] = result[i];
          updates[key + ".autorange"] = false;
        }
      }
      if (Object.keys(updates).length) await plotly.relayout(chart, updates);
    };
    const relayout = event => {
      if (Object.keys(event).some(key => /^xaxis\.(range|autorange)/.test(key))) return align();
    };
    const restyle = () => align();
    chart.on("plotly_relayout", relayout);
    chart.on("plotly_restyle", restyle);
    handlers.set(chart, {relayout, restyle});
    await align();
  }
  const api = {ranges, attach};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.AltitudeZeroAxes = api;
})();
