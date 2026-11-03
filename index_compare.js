// Adds the "Index from" option for a published indexed comparison. Plain values show until it is ticked.
(() => {
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "");

  function dateLabel(value) {
    const date = new Date(value + "T12:00:00Z");
    return new Intl.DateTimeFormat("en-NZ", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
    }).format(date);
  }

  // Returns the index date, or null for plain values. onChange gets the same.
  function setup(container, index, requested, onChange) {
    const on = document.createElement("input");
    on.type = "checkbox";
    on.id = "index-on";
    on.checked = isDate(requested);
    const toggle = document.createElement("label");
    toggle.htmlFor = "index-on";
    toggle.append(on, " Show as index from");
    const input = document.createElement("input");
    input.type = "date";
    input.id = "compare-from";
    input.value = isDate(requested) ? requested : index.date;
    const describe = () => input.setAttribute("aria-label", "Index date " + dateLabel(input.value));
    describe();
    container.append(toggle, " ", input);
    on.addEventListener("change", () => onChange(on.checked && isDate(input.value) ? input.value : null));
    // Choosing a date switches the index on.
    input.addEventListener("change", () => {
      if (!isDate(input.value)) return;
      describe();
      on.checked = true;
      onChange(input.value);
    });
    return on.checked ? input.value : null;
  }

  window.AltitudeIndex = {setup};
})();
