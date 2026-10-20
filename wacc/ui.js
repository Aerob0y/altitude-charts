(function () {
  "use strict";
  const W = AltitudeWacc, $ = id => document.getElementById(id);
  let scenarios = [], next_id = 0;
  const make = (tag, text, class_name) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (class_name) node.className = class_name;
    return node;
  };
  const values = scenario => Object.fromEntries(W.inputs.map(row => [row.key, W.parse_input(scenario.text[row.key], row.percent)]));
  function new_scenario(name, text) { return {id: ++next_id, name: name.slice(0, 24), text: {...text}}; }
  function update(scenario) {
    const errors = W.validate(values(scenario)), result = W.calculate(values(scenario));
    for (const row of W.inputs) {
      const input = $(`input-${scenario.id}-${row.key}`), message = $(`error-${scenario.id}-${row.key}`);
      input.setAttribute("aria-label", `${scenario.name}: ${row.label}${row.percent ? " (%)" : ""}`);
      input.setAttribute("aria-invalid", String(Boolean(errors[row.key])));
      message.textContent = errors[row.key] || "";
    }
    for (const row of W.derived) {
      const cell = $(`result-${scenario.id}-${row.key}`);
      cell.textContent = result ? W.format(row.key, result[row.key]) : "";
      cell.title = result && row.key === "wacc" ? W.format(row.key, result.wacc, true) : "";
    }
    $("download").disabled = scenarios.some(item => !W.calculate(values(item)));
    $("status").textContent = scenarios.some(item => !W.calculate(values(item))) ? "Check the marked inputs. Results are blank for that scenario." : "";
  }
  function render(focus_id) {
    const head = make("tr"), label = make("th", "WACC"); label.scope = "col"; head.append(label);
    for (const scenario of scenarios) {
      const th = make("th"), name = make("input"); th.scope = "col";
      name.type = "text"; name.value = scenario.name; name.maxLength = 24; name.className = "scenario-name";
      name.id = `name-${scenario.id}`; name.setAttribute("aria-label", "Scenario name");
      name.addEventListener("input", () => { scenario.name = name.value; update(scenario); });
      const actions = make("div", undefined, "actions");
      const copy = make("button", "Copy"), remove = make("button", "Remove");
      copy.type = remove.type = "button"; copy.disabled = scenarios.length >= 6; remove.hidden = scenarios.length === 1;
      copy.addEventListener("click", () => {
        if (scenarios.length >= 6) return;
        const item = new_scenario(scenario.name.slice(0, 19) + " copy", scenario.text);
        scenarios.splice(scenarios.indexOf(scenario) + 1, 0, item); render(item.id);
      });
      remove.addEventListener("click", () => {
        if (scenarios.length <= 1) return;
        const index = scenarios.indexOf(scenario); scenarios.splice(index, 1); render(scenarios[Math.min(index, scenarios.length - 1)].id);
      });
      actions.append(copy, remove); th.append(name, actions); head.append(th);
    }
    $("head").replaceChildren(head);
    const body = [];
    for (const row of [...W.inputs, ...W.derived]) {
      const editable = W.inputs.includes(row), tr = make("tr", undefined, editable ? row.fill || "" : row.key === "wacc" ? "total" : "derived");
      const label = make("th", row.label); label.scope = "row"; tr.append(label);
      for (const scenario of scenarios) {
        const td = make("td");
        if (editable) {
          const field = make("div", undefined, "field"), input = make("input"), message = make("span", undefined, "error");
          input.type = "number"; input.step = "any"; input.inputMode = "decimal"; input.value = scenario.text[row.key];
          input.id = `input-${scenario.id}-${row.key}`; message.id = `error-${scenario.id}-${row.key}`;
          input.setAttribute("aria-describedby", message.id);
          input.addEventListener("input", () => { scenario.text[row.key] = input.value; update(scenario); });
          field.append(input); if (row.percent) field.append(make("span", "%"));
          td.append(field, message);
        } else { td.id = `result-${scenario.id}-${row.key}`; }
        tr.append(td);
      }
      body.push(tr);
    }
    $("body").replaceChildren(...body);
    $("add").disabled = scenarios.length >= 6;
    $("limit").textContent = scenarios.length >= 6 ? "Six scenarios maximum. Remove one to add or copy another." : "Compare up to six scenarios. Scroll the table to see more columns.";
    scenarios.forEach(update);
    if (focus_id) { const name = $(`name-${focus_id}`); name.focus(); name.select(); }
  }
  function reset() {
    scenarios = [new_scenario("Mid", Object.fromEntries(W.inputs.map(row => [row.key, row.text])))]; render();
  }
  $("add").addEventListener("click", () => {
    if (scenarios.length >= 6) return;
    let number = 2; while (scenarios.some(item => item.name === `Scenario ${number}`)) number++;
    const item = new_scenario(`Scenario ${number}`, scenarios.at(-1).text); scenarios.push(item); render(item.id);
  });
  $("reset").addEventListener("click", reset);
  $("download").addEventListener("click", () => {
    if (scenarios.some(item => !W.calculate(values(item)))) return;
    const csv = W.to_csv(scenarios.map(item => ({name: item.name, values: values(item), text: item.text})));
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], {type: "text/csv;charset=utf-8"}));
    const link = make("a"); link.href = url; link.download = "altitude-wacc-scenarios.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  reset();
})();
