// Re-totals a small data cube in the browser (charts whose manifest has a cube
// block, e.g. International arrivals). The page loads this file, then calls
// AltitudeCube.setup with the cube, the chart's template specs and a callback
// that draws a finished spec. Templates: count (bars), pct (lines), compare (categories).
//
// Three choices make the chart: Show (over time, or by group for the latest
// 12 months), Period (each month or 12-month total; over time only) and
// Measure (arrivals, or the change on a year earlier or on 2019, in people or %).
window.AltitudeCube = (() => {
  const dot = " · ";
  // Rises above this come from a near-empty base (e.g. NZ residents' travel
  // purpose, barely recorded in 2019) and are left out.
  const maxPct = 500;

  const shows = {time: "Over time", group: "By group, latest 12 months"};
  const periods = {month: "Each month", rolling: "12-month total"};
  const measures = {
    arrivals: "Arrivals", ly_abs: "Change on a year earlier", vs19_abs: "Change on 2019",
    ly_pct: "% change on a year earlier", vs19_pct: "% change on 2019"
  };

  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    Object.assign(node, attrs);
    if (text != null) node.textContent = text;
    return node;
  }

  function addSelect(box, id, label, options, value) {
    const wrap = el("span", {className: "cube-control"});
    const select = el("select", {id});
    for (const [optionValue, text] of options) select.add(new Option(text, optionValue));
    if (value != null && options.some(([v]) => String(v) === String(value))) select.value = value;
    wrap.append(el("label", {htmlFor: id}, label), " ", select);
    box.append(wrap);
    return select;
  }

  // Monthly totals for each value of the split dimension, after the filters.
  function totals(cube, split, filters, quantity = "total") {
    const n = cube.months.length;
    const accommodation = !!cube.values;
    const origin = split === "Guest origin";
    const groups = origin ? ["Domestic", "International"] : split ? cube.dims[split] : [cube.labels.total];
    const keys = accommodation ? Object.keys(cube.values) : ["arrivals"];
    const sums = groups.map(() => Object.fromEntries(keys.map(key => [key, Array(n).fill(null)])));
    const missing = groups.map(() => Object.fromEntries(keys.map(key => [key, Array(n).fill(false)])));
    const active = Object.entries(filters).filter(([, value]) => value >= 0);
    const property = cube.dims["Property type"];
    const totalProperty = property ? property.indexOf("Total") : -1;
    const splitCol = split && !origin ? cube.columns[split] : null;
    const count = accommodation ? cube.month.length : cube.arrivals.length;
    rows: for (let row = 0; row < count; row++) {
      for (const [dim, wanted] of active) if (cube.columns[dim][row] !== wanted) continue rows;
      if (property && filters["Property type"] < 0) {
        const isTotal = cube.columns["Property type"][row] === totalProperty;
        if (split === "Property type" ? isTotal : !isTotal) continue;
      }
      const indexes = origin ? [0, 1] : [splitCol ? splitCol[row] : 0];
      for (const index of indexes) for (const key of keys) {
        const value = accommodation ? cube.values[key][row] : cube.arrivals[row];
        const month = cube.month[row];
        if (value == null) { missing[index][key][month] = true; continue; }
        sums[index][key][month] = (sums[index][key][month] ?? 0) + value;
      }
    }
    return groups.map((name, i) => {
      const key = origin ? (i ? "international" : "domestic") : quantity;
      const rate = key === "occupancy" || key === "utilisation";
      const numKey = rate ? "occupied" : (accommodation ? key : "arrivals");
      const denKey = key === "occupancy" ? "available" : "capacity";
      const numerator = sums[i][numKey].map((v, j) => missing[i][numKey][j] ? null : v);
      const denominator = rate ? sums[i][denKey].map((v, j) => missing[i][denKey][j] ? null : v) : null;
      if (!accommodation) for (let j = 0; j < n; j++) if (numerator[j] == null) numerator[j] = 0;
      return {name, y: numerator, denominator, colour: cube.colours[i % cube.colours.length]};
    }).filter(group => group.y.some(v => v != null && v !== 0) &&
      !(split && (quantity === "occupancy" || quantity === "utilisation") && group.name === "Other / unallocated"));
  }

  function aggregateSeries(cube, group, period) {
    const n = cube.months.length;
    const result = Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const start = period === "rolling" ? i - 11 : i;
      if (start < 0) continue;
      const values = group.y.slice(start, i + 1);
      const den = group.denominator?.slice(start, i + 1);
      if (values.some(v => v == null) || (den && den.some(v => v == null))) continue;
      const total = values.reduce((a, b) => a + b, 0);
      const base = den && den.reduce((a, b) => a + b, 0);
      result[i] = den ? (base > 0 ? 100 * total / base : null) : total;
    }
    return result;
  }

  const pct = (now, base) => base > 0 ? 100 * (now / base - 1) : null;
  const capped = value => value != null && value > maxPct ? null : value;

  // One value per month for "over time".
  function overTime(cube, group, period, measure) {
    const years = cube.months.map(m => Number(m.slice(0, 4)));
    const monthOf = cube.months.map(m => Number(m.slice(5, 7)));
    const s = aggregateSeries(cube, group, period);
    // Monthly comparisons use the same month; rolling comparisons use the cube baseline.
    const base2019 = {};
    years.forEach((year, i) => { if (year === 2019) base2019[monthOf[i]] = s[i]; });
    const baseline = s[cube.months.indexOf(cube.baseline_2019_end || "2019-12-01")];
    const values = s.map((value, i) => {
      if (value == null) return null;
      const lastYear = i >= 12 ? s[i - 12] : null;
      const base = period === "rolling" ? baseline : base2019[monthOf[i]];
      switch (measure) {
        case "arrivals": return value;
        case "ly_abs": return lastYear > 0 ? value - lastYear : null;
        // Growth on a closed-border year runs to thousands of per cent.
        case "ly_pct": return lastYear == null || (years[i] >= 2021 && years[i] <= 2023) ? null : pct(value, lastYear);
        case "vs19_abs": return years[i] >= 2020 && base > 0 ? value - base : null;
        case "vs19_pct": return years[i] >= 2020 && base != null ? pct(value, base) : null;
      }
      return null;
    });
    return measure.endsWith("_pct") ? values.map(capped) : values;
  }

  // One value per group for "by group": the latest 12 months against the 12 before or 2019.
  function byGroup(cube, group, measure) {
    const s = aggregateSeries(cube, group, "rolling");
    const n = s.length;
    const latest = s[n - 1], before = s[n - 13];
    const in2019 = s[cube.months.indexOf(cube.baseline_2019_end || "2019-12-01")];
    if (latest == null) return null;
    switch (measure) {
      case "arrivals": return latest;
      case "ly_abs": return before > 0 ? latest - before : null;
      case "ly_pct": return Number(cube.months[n - 1].slice(0, 4)) >= 2021 && Number(cube.months[n - 1].slice(0, 4)) <= 2023 ? null : capped(pct(latest, before));
      case "vs19_abs": return in2019 > 0 ? latest - in2019 : null;
      case "vs19_pct": return capped(pct(latest, in2019));
    }
    return null;
  }

  // The legend sits below the plot, placed relative to the plot's height. With
  // several rows (narrow frames, many groups) it ran past the bottom of the chart
  // and was cut off, so widen the bottom margin to fit the rows it will need.
  function reserveLegend(layout, names) {
    const width = Math.max(240, innerWidth - 60);
    let rows = 1, used = 0;
    for (const name of names) {
      const item = 40 + 7 * name.length;
      if (used && used + item > width) { rows++; used = 0; }
      used += item;
    }
    const narrow = innerWidth < 600;
    const chartHeight = document.getElementById("chart")?.clientHeight || 500;
    const legendRows = 22 * rows;
    const plotHeight = Math.max(150, chartHeight - (layout.margin?.t || 110) - 60 - legendRows);
    const offset = (narrow ? 0.25 : Math.abs(layout.legend?.y ?? 0.1)) * plotHeight;
    layout.margin = {...layout.margin, b: Math.round(Math.max(layout.margin?.b || 0, 40 + offset + legendRows))};
  }

  function retitle(layout, subtitle) {
    const title = layout.title?.text || "";
    const match = title.match(/^(.*<span[^>]*>)(.*)(<\/span>.*)$/s);
    layout.title = {...layout.title, text: match ? match[1] + subtitle + match[3] : title};
  }

  function describe(cube, show, period, measure) {
    const label = i => cube.month_labels[i];
    const n = cube.months.length;
    if (show === "group") {
      const latest = `Latest 12 months (${label(n - 12)} to ${label(n - 1)})`;
      return {
        arrivals: latest,
        ly_abs: `${latest}, change on the 12 months before`,
        ly_pct: `${latest}, % change on the 12 months before`,
        vs19_abs: `${latest}, change on ${cube.baseline_2019_label || "2019"}`,
        vs19_pct: `${latest}, % change on ${cube.baseline_2019_label || "2019"}`
      }[measure];
    }
    const base = period === "rolling" ? cube.labels.rolling : cube.labels.month;
    const on2019 = period === "rolling" ? (cube.baseline_2019_label || "calendar 2019") : "the same month in 2019";
    const onLastYear = period === "rolling" ? "a year earlier" : "the same month a year earlier";
    return {
      arrivals: base,
      ly_abs: `${base}, change on ${onLastYear}`,
      ly_pct: `${base}, % change on ${onLastYear}`,
      vs19_abs: `${base}, change on ${on2019}`,
      vs19_pct: `${base}, % change on ${on2019}`
    }[measure];
  }

  function build(cube, templates, choice, split, filters, filterLabels) {
    const {show, period, measure, quantity} = choice;
    const groups = totals(cube, split, filters, quantity);
    const rate = quantity === "occupancy" || quantity === "utilisation";
    const n = cube.months.length;
    const latest = cube.months.slice(-12);
    // By group, only the latest 12 months and the base they are compared with matter.
    const usesMonth = month => show === "time" || latest.includes(month) ||
      (measure.startsWith("ly") ? cube.months.indexOf(month) >= n - 24 : measure.startsWith("vs19") && month.startsWith("2019"));
    const shownEstimates = cube.estimated.filter(usesMonth);
    const isPct = measure.endsWith("_pct");

    let subtitle = describe(cube, show, period, measure);
    if (cube.quantities) subtitle = cube.quantities[quantity] + (rate ? ", %" : ", guest nights") + dot + subtitle.replace(/Arrivals|Guest nights/gi, "Value");
    if (rate && show === "time" && period === "rolling") subtitle = subtitle.replace("Value, 12-month total", "12-month rate");
    if (split) subtitle += " by " + split.toLowerCase();
    if (rate && split === "Region group") subtitle += " (unallocated rate not shown)";
    if (measure === "ly_pct") subtitle += " (2021 to 2023 left out)";
    if (isPct) subtitle += ` (rises over ${maxPct}% left out)`;
    if (shownEstimates.length) {
      subtitle += dot + shownEstimates.map(m => cube.month_labels[cube.months.indexOf(m)]).join(" and ") + " estimated";
    }
    if (cube.quantities) subtitle += dot + "Survey paused Oct 2019 to May 2020; incomplete 12-month totals left blank";
    if (cube.baseline_2019_end && measure.startsWith("vs19")) subtitle += dot + "Surveys and property categories changed in 2020";
    if (filterLabels.length) subtitle += dot + filterLabels.join(", ");
    subtitle += (rate ? "" : dot + cube.labels.unit) + dot + cube.labels.source;
    const format = (isPct || rate) ? ".0f" : ",.0f";
    const suffix = (isPct || rate) ? "%" : "";

    if (show === "group") {
      const template = templates[cube.templates.compare];
      const layout = structuredClone(template.layout);
      retitle(layout, subtitle);
      const names = groups.map(g => g.name);
      const values = groups.map(g => byGroup(cube, g, measure));
      const text = values.map(v => v == null ? "" : ((isPct || rate) ? `${measure !== "arrivals" && v >= 0 ? "+" : ""}${Math.round(v)}%` :
        `${measure === "arrivals" || v < 0 ? "" : "+"}${Math.round(v).toLocaleString("en-NZ")}`));
      const data = [{type: "bar", name: describe(cube, show, period, measure), x: names, y: values,
        marker: {color: groups.map(g => g.colour)}, text, textposition: "outside", cliponaxis: false,
        hovertemplate: `%{x}: %{y:${format}}${suffix}<extra></extra>`}];
      layout.xaxis = {...layout.xaxis, categoryarray: names};
      // Group names overlap on a phone, so slant them.
      if (innerWidth < 600) Object.assign(layout.xaxis, {tickangle: -45, automargin: true});
      if (cube.quantities) {
        layout.xaxis.type = "category";
        delete layout.xaxis.range;
        delete layout.xaxis.rangeselector;
        delete layout.xaxis.rangeslider;
        delete layout.yaxis.range;
        layout.yaxis.autorange = true;
      }
      layout.yaxis = {...layout.yaxis, tickformat: (isPct || rate) ? ".0f" : ",d", ticksuffix: suffix};
      layout.showlegend = false;
      return {data, layout, config: template.config};
    }

    const template = templates[(isPct || rate) ? cube.templates.pct : cube.templates.count];
    const layout = structuredClone(template.layout);
    retitle(layout, subtitle);
    layout.showlegend = !!split && groups.length > 1;
    if (layout.showlegend) reserveLegend(layout, groups.map(g => g.name));
    const series = groups.map(group => ({group, y: overTime(cube, group, period, measure)}));
    const traceFor = ({group, y}) => ({name: group.name, x: cube.months, y, legendgroup: group.name,
      hovertemplate: `${group.name}: %{y:${format}}${suffix}<extra></extra>`});
    let data;
    if (cube.quantities && period === "rolling" && !isPct && !rate && measure === "arrivals") {
      // A separate stack for each run of months with the same series present, so Plotly
      // never fills a survey gap with zero, and a group that only exists in some years
      // (e.g. "Lodges and other" from 2020) doesn't blank the years before it.
      const runs = [];
      for (let i = 0; i < cube.months.length; i++) {
        const present = series.map((item, j) => item.y[i] == null ? -1 : j).filter(j => j >= 0);
        if (!present.length) continue;
        const key = present.join(",");
        const last = runs[runs.length - 1];
        if (last && last.end === i && last.key === key) last.end++;
        else runs.push({start: i, end: i + 1, key, members: present});
      }
      const shown = new Set();
      data = runs.flatMap(({start, end, members}, run) => members.map(j => {
        const item = series[j];
        const first = !shown.has(j);
        shown.add(j);
        return {...traceFor(item), x: cube.months.slice(start, end), y: item.y.slice(start, end),
          type: "scatter", mode: "lines", line: {color: item.group.colour, width: 1.5},
          stackgroup: `run-${run}`, showlegend: first};
      }));
    } else {
      data = series.map(item => {
        const trace = traceFor(item);
        if (isPct || rate) return {...trace, type: "scatter", mode: "lines", line: {color: item.group.colour, width: 2}};
        if (cube.quantities && period === "rolling") return {...trace, type: "scatter", mode: "lines",
          line: {color: item.group.colour, width: 1.5}, ...(groups.length === 1 ? {fill: "tozeroy"} : {})};
        return {...trace, type: "bar", marker: {color: item.group.colour}};
      });
    }
    return {data, layout, config: template.config};
  }

  function setup(box, cube, templates, draw) {
    const params = new URLSearchParams(location.search);
    const dims = Object.keys(cube.dims);
    const showSelect = addSelect(box, "cube-show", "Show", Object.entries(shows), params.get("show") || "time");
    const periodSelect = addSelect(box, "cube-period", "Period", Object.entries(periods), params.get("period") || "month");
    const quantitySelect = cube.quantities ? addSelect(box, "cube-what", "What", Object.entries(cube.quantities), params.get("quantity") || "total") : null;
    const measureOptions = {...measures, arrivals: cube.labels.value};
    const measureSelect = addSelect(box, "cube-measure", "Measure", Object.entries(measureOptions), params.get("measure") || "arrivals");
    const splitSelect = addSelect(box, "cube-split", "Split by",
      [["", "Nothing (total)"], ...dims.filter(dim => !cube.quantities || dim !== "Region").map(dim => [dim, dim]), ...(cube.quantities ? [["Guest origin", "Guest origin"]] : [])], params.get("split") ?? cube.default_split);
    const filterSelects = Object.fromEntries(dims.map(dim => [dim,
      addSelect(box, "cube-" + dim.replace(/\W+/g, "-").toLowerCase(), dim,
        [[-1, "All"], ...cube.dims[dim].map((label, i) => [i, label]).filter(([, label]) => dim !== "Property type" || label !== "Total")],
        // A filter can be set by label in the link, e.g. ?Passenger%20type=Visitor (used by blog embeds).
        params.has(dim) ? cube.dims[dim].indexOf(params.get(dim)) : -1)]));

    let first = true;
    function redraw() {
      const choice = {show: showSelect.value, period: periodSelect.value, measure: measureSelect.value, ...(quantitySelect ? {quantity: quantitySelect.value} : {})};
      const originOption = Array.from(splitSelect.options).find(option => option.value === "Guest origin");
      if (originOption) { originOption.disabled = choice.quantity !== "total"; if (originOption.disabled && splitSelect.value === "Guest origin") splitSelect.value = ""; }
      // Period only applies over time.
      periodSelect.disabled = choice.show === "group";
      const split = splitSelect.value || null;
      const filters = {}, filterLabels = [];
      for (const [dim, select] of Object.entries(filterSelects)) {
        filters[dim] = Number(select.value);
        if (filters[dim] >= 0) filterLabels.push(select.selectedOptions[0].textContent);
      }
      const spec = build(cube, templates, choice, split, filters, filterLabels);
      const url = new URL(location.href);
      for (const [key, value] of Object.entries({...choice, split: splitSelect.value})) url.searchParams.set(key, value);
      for (const [dim, select] of Object.entries(filterSelects)) {
        if (filters[dim] >= 0) url.searchParams.set(dim, select.selectedOptions[0].textContent); else url.searchParams.delete(dim);
      }
      history.replaceState(null, "", url);
      draw(spec, first);
      first = false;
    }
    for (const select of [showSelect, periodSelect, measureSelect, splitSelect, ...Object.values(filterSelects), ...(quantitySelect ? [quantitySelect] : [])]) {
      select.addEventListener("change", redraw);
    }
    redraw();
  }

  return {setup, build, totals, overTime, byGroup};
})();
