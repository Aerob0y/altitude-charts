(async function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const number = (value, digits = 1) => new Intl.NumberFormat('en-NZ', {minimumFractionDigits: digits, maximumFractionDigits: digits}).format(value);
  const money = value => `${value < 0 ? '−' : ''}$${number(Math.abs(value) >= 1000 ? Math.abs(value) / 1000 : Math.abs(value))}${Math.abs(value) >= 1000 ? 'b' : 'm'}`;
  const signed = (value, digits = 1) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value), digits)}`;
  const colours = ['#12243D', '#0E6B6B', '#C8781E', '#6C8EBF', '#7E8C3A', '#9B5C7E', '#8A8781'];
  const text = (tag, value, attrs = {}) => {
    const element = document.createElement(tag); element.textContent = value;
    Object.entries(attrs).forEach(([key, val]) => element.setAttribute(key, val)); return element;
  };
  async function json(path) {
    const embedded = document.getElementById(`budget-${path.replace('.json', '')}`);
    if (embedded) return JSON.parse(embedded.textContent);
    const response = await fetch(path); if (!response.ok) throw Error(`Could not load ${path}`); return response.json();
  }
  try {
    const data = Budget.validate(await json('data.json'));
    const history = Budget.validateHistory(await json('history.json'));
    let spec = null;
    try { spec = await json('trend.json'); } catch (_) { $('chart-warning').textContent = 'The chart could not load. All figures remain available in the tables.'; }
    const nodes = new Map(), parents = new Map();
    Budget.walk(data.root, (node, parent) => {nodes.set(node.id, node); parents.set(node.id, parent);});
    let selected = data.root, revision = 0, chartQueue = Promise.resolve();
    const lastActual = data.statuses.findLastIndex(status => status !== 'Forecast');
    function yearOptions() {
      const last = $('forecasts').checked ? data.years.length - 1 : lastActual;
      for (const [id, fallback] of [['from-year', 0], ['to-year', lastActual]]) {
        const previous = $(id).value === '' ? fallback : Number($(id).value);
        $(id).replaceChildren(...data.years.slice(0, last + 1).map((year, i) => text('option', `${year} · ${data.statuses[i].toLowerCase()}`, {value: i})));
        $(id).value = String(Math.min(previous, last));
      }
    }
    function pathTo(node) {const path = []; while (node) {path.unshift(node); node = parents.get(node.id);} return path;}
    function open(id) {selected = nodes.get(id); render();}
    function visualGroups(from, to) {
      const parts = selected.children.length ? selected.children : [selected];
      const ranked = [...parts].sort((a, b) => Math.max(Math.abs(b.values[from]), Math.abs(b.values[to])) - Math.max(Math.abs(a.values[from]), Math.abs(a.values[to])) || a.name.localeCompare(b.name));
      const groups = ranked.slice(0, 6).map(node => ({id: node.id, name: node.name, nodes: [node]}));
      if (ranked.length > 6) groups.push({id: null, name: 'Other and adjustments', nodes: ranked.slice(6)});
      return groups.map((group, i) => ({...group, colour: colours[i], values: data.years.map((_, year) => group.nodes.reduce((sum, node) => sum + node.values[year], 0))}));
    }
    function tileCounts(groups, year) {
      const amounts = groups.map(group => group.nodes.reduce((sum, node) => sum + Math.max(0, node.values[year]), 0));
      const total = amounts.reduce((sum, value) => sum + value, 0);
      if (total <= 0) return {counts: amounts.map(() => 0), total};
      const raw = amounts.map(value => 100 * value / total), counts = raw.map(Math.floor);
      let remaining = 100 - counts.reduce((sum, value) => sum + value, 0);
      [...raw.keys()].sort((a, b) => raw[b] - counts[b] - (raw[a] - counts[a])).slice(0, remaining).forEach(i => counts[i]++);
      return {counts, total};
    }
    function drawWaffles(groups, from, to) {
      const years = [from, to];
      const totals = years.map(year => tileCounts(groups, year).total);
      const charts = years.map(year => {
        const {counts, total} = tileCounts(groups, year);
        const figure = text('figure', '', {class: 'waffle'}), caption = text('figcaption', '');
        caption.append(text('strong', String(data.years[year])), text('span', `${data.statuses[year]} · ${money(selected.values[year])}`));
        figure.append(caption);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `${selected.name} in ${data.years[year]}. One hundred tiles show the positive spending breakdown.`);
        let tile = 0;
        groups.forEach((group, groupIndex) => {
          for (let i = 0; i < counts[groupIndex]; i++, tile++) {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', String((tile % 10) * 10 + 1)); rect.setAttribute('y', String((9 - Math.floor(tile / 10)) * 10 + 1));
            rect.setAttribute('width', '8'); rect.setAttribute('height', '8'); rect.setAttribute('rx', '1'); rect.setAttribute('fill', group.colour);
            svg.append(rect);
          }
        });
        if (total <= 0) svg.setAttribute('aria-label', `${selected.name} has no positive spending to show in ${data.years[year]}.`);
        figure.append(svg); return figure;
      });
      $('waffles').replaceChildren(...charts);
      const legend = groups.map(group => {
        const row = text('div', '', {class: 'waffle-key'}), swatch = text('i', '', {'aria-hidden': 'true'}); swatch.style.background = group.colour;
        const label = group.id ? text('button', group.name, {type: 'button', class: 'waffle-category'}) : text('span', group.name);
        if (group.id) label.onclick = () => open(group.id);
        const shares = years.map((year, i) => {
          const value = group.nodes.reduce((sum, node) => sum + Math.max(0, node.values[year]), 0);
          return totals[i] ? number(100 * value / totals[i], 0) : '0';
        });
        row.append(swatch, label, text('span', `${shares[0]}% / ${shares[1]}%`)); return row;
      });
      $('waffle-legend').replaceChildren(...legend);
      $('waffle-subtitle').textContent = `Each square is 1% of the positive spending inside ${selected.name}. Legend values are ${data.years[from]} / ${data.years[to]}.`;
      const negatives = years.flatMap(year => groups.flatMap(group => group.nodes.map(node => ({year, node, value: node.values[year]})).filter(item => item.value < 0)));
      $('waffle-note').textContent = negatives.length ? `Negative adjustments cannot be tiles: ${negatives.map(item => `${item.node.name} is ${money(item.value)} in ${data.years[item.year]}`).join('; ')}. They remain included in totals, the stacked chart and the table.` : '';
    }
    function drawChart() {
      if (!spec || !window.Plotly) {
        $('chart-warning').textContent = 'The chart could not load. Use the exact annual figures below.';
        return;
      }
      const currentRevision = ++revision;
      const last = $('forecasts').checked ? data.years.length - 1 : lastActual;
      const share = $('measure').value === 'share';
      const from = Number($('from-year').value), to = Number($('to-year').value), groups = visualGroups(from, to);
      const dates = data.years.map(year => `${year}-06-30`);
      const traces = groups.map(group => ({type: 'bar', name: group.name, legendgroup: group.name, x: dates.slice(0, last + 1),
        y: group.values.slice(0, last + 1).map((value, i) => share ? 100 * value / data.root.values[i] : value / 1000), marker: {color: group.colour},
        hovertemplate: `%{x|%Y}: ${share ? '' : 'NZ$'}%{y:,.2f}${share ? '%' : 'b'}<extra>${group.name}</extra>`}));
      const layout = structuredClone(spec.layout);
      layout.title = {text: ''}; layout.annotations = []; layout.showlegend = groups.length > 1; layout.barmode = 'relative'; layout.bargap = .25;
      layout.autosize = true; delete layout.width; delete layout.height;
      layout.margin = {l: 58, r: 15, t: 12, b: groups.length > 1 ? 105 : 42};
      layout.legend = {...layout.legend, orientation: 'h', x: 0, xanchor: 'left', y: -.18, yanchor: 'top', traceorder: 'normal'};
      layout.yaxis = {...layout.yaxis, autorange: true, rangemode: 'tozero', title: {text: ''}, tickformat: ',.1f', tickprefix: share ? '' : '$', ticksuffix: share ? '%' : 'b', fixedrange: true};
      layout.xaxis = {...layout.xaxis, type: 'date', range: [dates[0], dates[last]], autorange: false,
        tickformat: '%Y', tickmode: 'array', tickvals: dates.slice(0, last + 1),
        ticktext: data.years.slice(0, last + 1).map(String), fixedrange: true};
      delete layout.xaxis.rangeselector; delete layout.xaxis.rangeslider;
      layout.shapes = $('forecasts').checked ? [{type: 'rect', xref: 'x', yref: 'paper', x0: `${data.years[lastActual]}-12-31`, x1: dates[last], y0: 0, y1: 1, fillcolor: '#EFE8DC', line: {width: 0}, layer: 'below'}] : [];
      if ($('forecasts').checked) layout.annotations = [{xref: 'paper', yref: 'paper', x: .99, y: .99, text: 'Forecast', showarrow: false, xanchor: 'right'}];
      chartQueue = chartQueue.catch(() => {}).then(() => {
        if (currentRevision !== revision) return;
        return Plotly.react($('trend'), traces, layout, {responsive: true, displayModeBar: false});
      }).catch(() => {$('chart-warning').textContent = 'The chart could not draw. Use the exact annual figures below.';});
    }
    function render() {
      const from = Number($('from-year').value), to = Number($('to-year').value);
      const shareMode = $('measure').value === 'share';
      const summary = Budget.compare(selected, from, to, data.root);
      const rows = Budget.rows(selected, from, to, data.root);
      $('comparison-note').textContent = `${data.years[from]} (${data.statuses[from].toLowerCase()}) compared with ${data.years[to]} (${data.statuses[to].toLowerCase()}). ${from > to ? 'You are comparing back to an earlier year. ' : ''}Source snapshot: 29 September 2026.`;
      const path = pathTo(selected), crumbs = [];
      path.forEach((node, i) => {
        if (i) crumbs.push(text('span', '/', {'aria-hidden': 'true'}));
        if (i === path.length - 1) crumbs.push(text('span', node.name, {'aria-current': 'page'}));
        else {const button = text('button', node.name, {type: 'button'}); button.onclick = () => open(node.id); crumbs.push(button);}
      });
      $('breadcrumbs').replaceChildren(...crumbs);
      $('total-label').textContent = `${selected.name} · ${data.years[to]}`;
      $('total').textContent = money(summary.after);
      $('total-status').textContent = data.statuses[to];
      $('change-label').textContent = `Change from ${data.years[from]} to ${data.years[to]}`;
      $('change').textContent = `${summary.change > 0 ? '+' : summary.change < 0 ? '−' : ''}${money(Math.abs(summary.change))}`;
      $('change-percent').textContent = summary.percent === null ? 'Percentage change unavailable from a zero base' : `${signed(summary.percent)}% in nominal dollars`;
      $('share').textContent = `${number(summary.share)}%`;
      $('chart-title').textContent = `${selected.name} over time`;
      $('chart-subtitle').textContent = `${shareMode ? 'Share of all core Crown expenses, per cent' : 'NZ dollars, billions; not adjusted for inflation'}. Stacked by the largest categories in the two selected years. ${$('forecasts').checked ? 'Shading shows forecasts.' : '2026 is unaudited actual.'}`;
      drawWaffles(visualGroups(from, to), from, to);
      $('breakdown-title').textContent = selected.children.length ? 'Inside this category' : 'Year comparison';
      $('table-caption').textContent = shareMode ? 'Share of all core Crown expenses (%). Changes are percentage points.' : 'NZ dollars, millions. Percentage changes use the first selected year as the base.';
      const head = text('tr', '');
      ['Category', String(data.years[from]), String(data.years[to]), shareMode ? 'Change (pp)' : 'Change ($m)', shareMode ? 'Change ($m)' : 'Change (%)', 'Share (%)'].forEach(label => head.append(text('th', label, {scope: 'col'})));
      $('table-head').replaceChildren(head);
      function tableRow(result, isTotal = false) {
        const tr = text('tr', ''); const label = text('th', '', {scope: 'row'});
        if (isTotal || !selected.children.length) label.textContent = isTotal ? 'Total selected category' : result.name;
        else {
          const button = text('button', result.name, {type: 'button', class: 'category', 'data-category': result.id});
          button.append(text('span', nodes.get(result.id).children.length ? 'Open breakdown →' : 'View history →'));
          button.onclick = () => open(result.id); label.append(button);
        }
        tr.append(label);
        const cells = shareMode ? [number(result.shareBefore), number(result.share), signed(result.share - result.shareBefore), signed(result.change, 0), number(result.share)] : [number(result.before, 0), number(result.after, 0), signed(result.change, 0), result.percent === null ? 'n.a.' : signed(result.percent), number(result.share)];
        cells.forEach(value => tr.append(text('td', value))); return tr;
      }
      $('table-body').replaceChildren(...rows.map(row => tableRow(row)));
      $('table-foot').replaceChildren(...(selected.children.length ? [tableRow(summary, true)] : []));
      const largest = rows.reduce((a, b) => Math.abs(a.change) >= Math.abs(b.change) ? a : b);
      $('finding').textContent = from === to ? 'The same year is selected, so the change is zero.' : selected.children.length ? `${largest.name} has the largest absolute change within this breakdown: ${largest.change < 0 ? 'down' : 'up'} ${money(Math.abs(largest.change))}. Open it to inspect the detail.` : 'This is the most detailed expense line included in this explorer.';
      const sourceNotes = [...new Set(path.flatMap(node => Array.isArray(node.notes) ? node.notes : [node.notes]).filter(Boolean))];
      $('source-notes').replaceChildren(...(sourceNotes.length ? [text('strong', 'Treasury table notes'), ...sourceNotes.map(note => text('p', note))] : []));
      $('history-caption').textContent = `${selected.name}. Values as published in the September 2026 release.`;
      const last = $('forecasts').checked ? data.years.length - 1 : lastActual;
      $('history-body').replaceChildren(...data.years.slice(0, last + 1).map((year, i) => {const tr = text('tr', ''); tr.append(text('th', String(year), {scope: 'row'}), text('td', data.statuses[i]), text('td', number(selected.values[i], 0))); return tr;}));
      drawChart();
    }
    yearOptions();
    ['from-year', 'to-year', 'measure'].forEach(id => $(id).addEventListener('change', render));
    $('forecasts').addEventListener('change', () => {yearOptions(); render();});
    $('download').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob(['\ufeff', Budget.fullCsv(data, history)], {type: 'text/csv;charset=utf-8'}));
      const link = document.createElement('a'); link.href = url; link.download = 'nz-budget-data-1972-2031.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $('explorer').hidden = false; $('status').textContent = ''; render();
  } catch (error) {
    $('status').textContent = `The spending data could not load. Please reload or use the original Excel workbook below. (${error.message})`;
  }
})();
