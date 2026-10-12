// "Today's dollars": rescales the dollar series of a chart spec to latest-quarter prices,
// as standard_plot(real = TRUE) does in R. Traces that can be adjusted carry
// meta.real (set from the guide's Real column); cpi.json holds, for each quarter,
// CPI(latest quarter) / CPI(that quarter). Dates after the latest CPI quarter keep
// their value; dates before the CPI starts are left out.
(() => {
  const quarterOf = x => {
    const text = String(x);
    return text.slice(0, 4) + "Q" + Math.ceil(Number(text.slice(5, 7)) / 3);
  };
  const isReal = trace => trace?.meta?.real === true;

  // True when the chart has at least one series the toggle changes.
  function adjustable(spec) {
    return Array.isArray(spec?.data) && spec.data.some(isReal);
  }

  function factorFor(cpi, x) {
    if (x === null || x === undefined) return null;
    const quarter = quarterOf(x);
    if (quarter in cpi.factors) return cpi.factors[quarter];
    return quarter > cpi.latest ? 1 : null;
  }

  function apply(spec, cpi) {
    if (!adjustable(spec)) return spec;
    const out = structuredClone(spec);
    const later = out.data.some(trace => isReal(trace) && [].concat(trace.x ?? []).some(x => x !== null && quarterOf(x) > cpi.latest));
    const axes = new Map();
    for (const trace of out.data) {
      if (!isReal(trace)) continue;
      const xs = [].concat(trace.x ?? []), ys = [].concat(trace.y ?? []);
      const scaled = ys.map((y, i) => {
        const factor = factorFor(cpi, xs[i]);
        return y === null || factor === null ? null : y * factor;
      });
      // A lone end label stores x and y as numbers rather than arrays.
      trace.y = Array.isArray(trace.y) ? scaled : scaled[0];
      const axis = (trace.yaxis || "y").replace(/^y/, "yaxis");
      if (!axes.has(axis)) axes.set(axis, trace.meta.dim === "$" ? "NZD" : trace.meta.dim);
    }
    const layout = out.layout ||= {};
    for (const [axis, dim] of axes) {
      const current = layout[axis]?.title;
      const text = (typeof current === "object" ? current?.text : current) || dim || "";
      layout[axis] = {...layout[axis], title: {...(typeof current === "object" ? current : {}), text: `${text}, ${cpi.label}`}};
    }
    const note = `In ${cpi.label}${later ? "; later months not adjusted" : ""}`;
    const title = layout.title?.text;
    if (typeof title === "string" && title.endsWith("</span>")) {
      const body = title.slice(0, -"</span>".length);
      layout.title = {...layout.title, text: `${body}${body.endsWith(">") ? "" : ". "}${note}</span>`};
    }
    return out;
  }

  window.AltitudeReal = {adjustable, apply};
})();
