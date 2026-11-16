# NZ Budget explorer: first working version

Issue #435. A static WIP tool, with year comparisons, category drill-down,
stacked annual charts, two-year waffle comparisons, source notes and a tidy CSV
download. Recent detail uses one frozen Treasury release so the categories and
annual totals reconcile. A separate Treasury file adds high-level
history from 1972 to 2026.

Source: Treasury, PREFU 2026 Core Crown Expense Tables, published
29 September 2026. Downloaded 16 November 2026 from:
https://www.budget.govt.nz/budget/excel/prefu2026/prefu26-data-expense-tables.xlsx

Years ended June 2022–2025 are actuals, 2026 is unaudited actual in this
release, and 2027–2031 are forecasts. The default view ends in 2026.
Core Crown expenses are not total Crown spending or the annual Budget's
new initiatives. Capital purchases and debt repayments are excluded.
Values include non-cash expenses and are not inflation-adjusted.

Long-run actuals come from Treasury's Fiscal Time Series Historical Fiscal
Indicators 1972–2026. The explorer stores 23 spending, tax, balance, revenue
and GDP series. This is a broad-trend dataset, not one consistent accounting
series: its metadata records changes in year end, GST treatment and accounting
basis. The recent PREFU hierarchy remains a separate dataset because overlapping
values and category definitions can differ between releases.

## Build and check

Download that workbook to a temporary location, then run from the repo root:

```text
Rscript --no-init-file dev/build_budget_explorer.R <downloaded-workbook.xlsx>
Rscript --no-init-file dev/build_budget_history.R <fiscal-time-series.xlsx>
node dev/check_budget_explorer.cjs
node dev/check_budget_explorer.cjs --browser
node dev/build_budget_preview.cjs
Rscript --no-init-file dev/check_all.R
Rscript --no-init-file dev/check_budget_publish.R
```

The browser check needs an existing Playwright installation and Microsoft Edge.
It starts and closes its own local HTTP server. No packages are installed.
The builder makes no network calls and does not modify app/data. It checks
every parent/detail total against the workbook for every year. Source row
numbers, labels, release date and workbook MD5 are retained in data.json.
The history builder writes history.json. The download combines both files in a
long format with stable path IDs, source rows, accounting basis, year end and a
comparability note. It keeps overlapping historical and PREFU observations as
separate rows rather than silently choosing one vintage.
The annual chart starts from standard_plot and plotly_to_spec_json, then groups
the largest categories into a stacked bar view. Two 100-tile waffles compare
the composition of the selected years. Negative forecast adjustments are not
drawn as waffle tiles; the page names them and keeps them in the chart, totals
and table. plotly.min.js is copied from the
installed R plotly package; its upstream licence header is retained.

Serve app/www/publish with a local HTTP server and open /budget/ to preview.
Alternatively, open publish/budget-preview.html directly after running the
preview builder. This ignored review file embeds its data and scripts and
does not need a server. It is not deployed or committed.
The normal publisher copies this folder and places its catalogue card on WIP.
There is no new Shiny tab, live updater or deployment in this task.

## What to decide next

- Whether this breakdown and drill-down answer readers' first questions.
- Inflation and population comparisons using fiscal-year denominators.
- A sourced explanation of major changes, beyond identifying their components.
- Classification of commitments and time horizons for changing spending.
- Income-tax scenarios, followed by other taxes with separate tax-base models.

No forced/optional percentages or tax estimates are claimed in this version.
Treasury footnotes remain visible because some detailed classifications change.
