// Pure calculations. Rates are fractions; input text and CSV use percentages.
(function (root) {
  "use strict";
  const defaults = Object.freeze({rf: .0515, tamrp: .075, leverage: .25, tc: .28, ti: .28, asset_beta: .70, kd: .0665});
  const inputs = Object.freeze([
    {key: "rf", label: "Risk-free rate", percent: true, fill: "judgement", text: "5.15"},
    {key: "tamrp", label: "Tax-adjusted market risk premium", percent: true, fill: "judgement", text: "7.5"},
    {key: "leverage", label: "Leverage (D / V)", percent: true, fill: "judgement", text: "25"},
    {key: "tc", label: "Corporate tax rate", percent: true, text: "28"},
    {key: "ti", label: "Investor marginal tax rate", percent: true, text: "28"},
    {key: "asset_beta", label: "Asset beta", fill: "judgement", text: "0.70"},
    {key: "kd", label: "Pre-tax cost of debt", percent: true, fill: "debt", text: "6.65"}
  ]);
  const derived = Object.freeze([
    {key: "cost_of_debt", label: "Post-tax cost of debt", percent: true},
    {key: "equity_beta", label: "Equity beta"},
    {key: "cost_of_equity", label: "Post-tax cost of equity", percent: true},
    {key: "wacc", label: "WACC (post-tax)", percent: true}
  ]);
  function validate(values) {
    const errors = {};
    for (const {key} of inputs) {
      if (typeof values?.[key] !== "number" || !Number.isFinite(values[key])) errors[key] = "Enter a number.";
    }
    if (!errors.leverage && (values.leverage < 0 || values.leverage >= 1)) errors.leverage = "Use 0 to under 100%.";
    for (const key of ["tc", "ti"]) {
      if (!errors[key] && (values[key] < 0 || values[key] > 1)) errors[key] = "Use 0 to 100%.";
    }
    if (!errors.asset_beta && values.asset_beta < 0) errors.asset_beta = "Use 0 or more.";
    return errors;
  }
  function calculate(values) {
    if (Object.keys(validate(values)).length) return null;
    const {rf, tamrp, leverage, tc, ti, asset_beta, kd} = values;
    const cost_of_debt = kd * (1 - tc);
    const equity_beta = asset_beta / (1 - leverage);
    const cost_of_equity = rf * (1 - ti) + equity_beta * tamrp;
    const wacc = (1 - leverage) * cost_of_equity + leverage * cost_of_debt;
    const result = {cost_of_debt, equity_beta, cost_of_equity, wacc};
    return Object.values(result).every(Number.isFinite) ? result : null;
  }
  function parse_input(text, percent = false) {
    if (typeof text !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim())) return NaN;
    const number = Number(text);
    return Number.isFinite(number) ? number / (percent ? 100 : 1) : NaN;
  }
  function format(key, value, precise = false) {
    if (!Number.isFinite(value)) return "";
    if (key === "equity_beta" || key === "asset_beta") return value.toFixed(2);
    return (value * 100).toFixed(key === "wacc" && !precise ? 1 : 2) + "%";
  }
  function to_csv(scenarios) {
    const escape = value => /[",\r\n]/.test(String(value)) ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
    const results = scenarios.map(scenario => calculate(scenario.values));
    const rows = [["WACC", ...scenarios.map(scenario => scenario.name)]];
    for (const row of [...inputs, ...derived]) {
      rows.push([row.label, ...scenarios.map((scenario, i) => {
        const value = inputs.includes(row) ? scenario.values[row.key] : results[i]?.[row.key];
        if (!Number.isFinite(value)) return "";
        // Preserve the entered percentage rather than introducing a conversion artefact.
        if (inputs.includes(row) && scenario.text) return Number(scenario.text[row.key]);
        return value * (row.percent ? 100 : 1);
      })]);
    }
    return rows.map(row => row.map(escape).join(",")).join("\r\n") + "\r\n";
  }
  const api = {defaults, inputs, derived, validate, calculate, parse_input, format, to_csv};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AltitudeWacc = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
