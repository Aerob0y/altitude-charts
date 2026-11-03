// One calculation for the dashboard and published charts.
(() => {
  const handlers = new WeakMap();
  const dateValue = value => typeof value === "number" ? value : Date.parse(value);

  // Bars and filled areas keep zero in view; stacked ones are fitted to their totals.
  function ranges(data, window, alignZeros = false, barmode = "") {
    const bounds = [[Infinity, -Infinity], [Infinity, -Infinity]], counts = [0, 0], anchored = [false, false];
    const stacks = [new Map(), new Map()];
    const dates = window?.map(dateValue);
    for (const trace of data) {
      if (trace.mode === "text" || trace.visible === false || trace.visible === "legendonly") continue;
      const axis = trace.yaxis === "y2" ? 1 : 0;
      const bar = trace.type === "bar";
      if (bar || trace.stackgroup || /^to(zero|next)y$/.test(trace.fill || "")) anchored[axis] = true;
      const stack = trace.stackgroup || (bar && /^(stack|relative)$/.test(barmode) ? "bars" : null);
      (trace.y || []).forEach((value, i) => {
        if (!Number.isFinite(value)) return;
        const date = dateValue(trace.x?.[i]);
        if (dates && (date < dates[0] || date > dates[1] || !Number.isFinite(date))) return;
        if (stack) {
          const key = `${stack}|${trace.x?.[i]}|${trace.stackgroup || value >= 0 ? "+" : "-"}`;
          value += stacks[axis].get(key) || 0;
          stacks[axis].set(key, value);
        }
        bounds[axis][0] = Math.min(bounds[axis][0], value);
        bounds[axis][1] = Math.max(bounds[axis][1], value);
        counts[axis]++;
      });
    }
    if (!counts[0] || (alignZeros && !counts[1])) return null;
    const padded = bounds.map(([min, max], axis) => {
      if (!counts[axis]) return [0, 1];
      // Two axes pad past the shared zero so it never sits on an edge.
      if (alignZeros || anchored[axis]) [min, max] = [Math.min(min, 0), Math.max(max, 0)];
      const padding = (max - min || Math.max(Math.abs(min), 1)) * 0.08;
      const range = [min - padding, max + padding];
      // Padding alone should not push an all-positive (or all-negative) axis across zero.
      if (min >= 0 && (max > 0 || alignZeros)) range[0] = Math.max(range[0], 0);
      if (!alignZeros && max <= 0 && min < 0) range[1] = Math.min(range[1], 0);
      return range;
    });
    if (!alignZeros) return padded;
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
    const keys = chart.layout?.yaxis2 && chart.data?.some(trace => trace.yaxis === "y2")
      ? ["yaxis", "yaxis2"] : ["yaxis"];
    const managed = new Set();
    const fixed = new Set(keys.filter(key => chart.layout[key]?.autorange === false));
    const align = async () => {
      const xaxis = chart._fullLayout?.xaxis;
      const result = ranges(chart.data, xaxis?.type === "date" ? xaxis.range : null, keys.length === 2,
        chart._fullLayout?.barmode || chart.layout?.barmode);
      if (!result) return;
      const updates = {};
      for (const [i, key] of keys.entries()) {
        if (fixed.has(key) && !managed.has(key)) continue;
        const current = chart.layout[key]?.range;
        if (chart.layout[key]?.autorange !== false || !current || result[i].some((v, j) => Math.abs(v - current[j]) > 1e-9)) {
          updates[key + ".range"] = result[i];
          updates[key + ".autorange"] = false;
          managed.add(key);
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
