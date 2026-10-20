# WACC calculator

Browser-only scenario table using the simplified Brennan–Lally method.
Rates are entered as percentages and calculated as fractions, without rounding
inputs. Mid defaults are illustrative. No storage, server calls or live rates.

- Post-tax Kd = kd × (1 − tc)
- Equity beta = asset_beta / (1 − leverage), with debt beta zero
- Post-tax Ke = rf × (1 − ti) + equity_beta × tamrp
- WACC = (1 − leverage) × Ke + leverage × kd × (1 − tc)

Add, copy, rename and remove up to six scenarios. Reset restores Mid.
Invalid inputs blank that column's results and disable CSV until corrected.
CSV rows match the table; percentages are unrounded numbers, with no % sign.
Debt issuance costs, swap costs and pre-tax WACC are excluded.

Check from the repository root:

```text
node dev/check_wacc.cjs
Rscript dev/check_publish_all.R
Rscript dev/check_all.R
Rscript dev/publish_all.R --no-image
Rscript dev/serve_site.R
```

Open `/wacc/`; check scenario controls, CSV and a 375px viewport. The table
scrolls horizontally while the row labels remain visible.
