(() => {
  const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);

  function setup(container, chart, manifest, fallback) {
    const details = document.createElement("details");
    details.className = "image-download";
    details.innerHTML = `<summary>Download image</summary>
      <form class="image-options">
        <label>Format <select name="format"><option value="png">PNG</option><option value="svg">SVG</option></select></label>
        <label>Size <select name="size"><option value="1600,900" selected>1600 × 900 (slides and posts)</option><option value="1200,750">1200 × 750 (chart library)</option><option value="custom">Custom</option></select></label>
        <span class="image-custom" hidden><label>Width <input name="width" type="number" min="100" max="8000" step="1" value="1600" required></label><label>Height <input name="height" type="number" min="100" max="8000" step="1" value="900" required></label></span>
        <label class="image-sharpness">Sharpness <select name="scale"><option value="1">1×</option><option value="2" selected>2×</option><option value="3">3×</option></select></label>
        <label class="image-clean"><input name="clean" type="checkbox" checked> Clean (hide chart buttons)</label>
        <button type="submit">Save image</button>
        <span class="image-message" role="status"></span>
      </form><span class="image-fallback" hidden></span>`;
    const form = details.querySelector("form");
    const field = name => form.elements.namedItem(name);
    const message = details.querySelector(".image-message");
    const fallbackBox = details.querySelector(".image-fallback");
    if (fallback) {
      const link = document.createElement("a");
      link.href = fallback;
      link.download = "";
      link.textContent = "Download pre-built PNG";
      fallbackBox.append(link);
    } else fallbackBox.textContent = "The chart is loading. Reopen these options when it is ready.";
    details.addEventListener("toggle", () => {
      const ready = Boolean(window.Plotly && chart.data && !chart.hasAttribute("aria-hidden"));
      form.hidden = !ready;
      fallbackBox.hidden = ready;
      // Short phone charts can place the toggle beneath the fixed panel.
      const top = details.querySelector("summary").getBoundingClientRect().top;
      for (const panel of [form, fallbackBox]) {
        panel.style.bottom = innerWidth < 600 ? `${Math.max(8, innerHeight - top + 8)}px` : "";
        panel.style.maxHeight = innerWidth < 600 ? `${Math.max(120, top - 24)}px` : "";
      }
    });
    field("size").addEventListener("change", () => {
      const custom = field("size").value === "custom";
      details.querySelector(".image-custom").hidden = !custom;
      field("width").disabled = !custom;
      field("height").disabled = !custom;
    });
    field("width").disabled = true;
    field("height").disabled = true;
    field("format").addEventListener("change", () => {
      details.querySelector(".image-sharpness").hidden = field("format").value !== "png";
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const [width, height] = field("size").value === "custom"
        ? [Number(field("width").value), Number(field("height").value)] : field("size").value.split(",").map(Number);
      const format = field("format").value;
      const scale = format === "png" ? Number(field("scale").value) : 1;
      const save = form.querySelector("button");
      save.disabled = true;
      message.textContent = "Preparing image…";
      // A temporary chart keeps export settings from changing the reader's chart.
      const temporary = document.createElement("div");
      Object.assign(temporary.style, {position: "fixed", left: "-20000px", top: "0", width: width + "px", height: height + "px"});
      document.body.append(temporary);
      try {
        const layout = structuredClone(chart.layout);
        layout.width = width;
        layout.height = height;
        layout.autosize = false;
        // Charts are transparent on the page; saved images are white.
        layout.paper_bgcolor = layout.plot_bgcolor = "#FFFFFF";
        if (chart._altitudeExportTitle) layout.title = structuredClone(chart._altitudeExportTitle);
        if (chart._altitudeExportSelector && layout.xaxis) layout.xaxis.rangeselector = structuredClone(chart._altitudeExportSelector);
        layout.margin = {...layout.margin, t: Math.max(layout.margin?.t || 0, 110)};
        layout.margin = {...layout.margin, l: Math.max(layout.margin?.l || 0, 70), r: Math.max(layout.margin?.r || 0, 70), b: Math.max(layout.margin?.b || 0, 140)};
        for (const key of Object.keys(chart._fullLayout).filter(key => /^[xy]axis\d*$/.test(key))) {
          if (!layout[key]) continue;
          layout[key].range = [...chart._fullLayout[key].range];
          layout[key].autorange = false;
          if (field("clean").checked && layout[key].rangeselector) layout[key].rangeselector.visible = false;
          if (field("clean").checked && layout[key].rangeslider) layout[key].rangeslider.visible = false;
        }
        // Pinned a fixed distance above the image's bottom edge, so it sits the same at every image size.
        layout.annotations = [...(layout.annotations || []), {text: "Source: " + escapeHtml(manifest.source || "not recorded"), xref: "paper", yref: "paper", x: 0, y: 0, yshift: -(layout.margin.b - 28), xanchor: "left", yanchor: "top", showarrow: false, font: {family: "Inter, Arial, sans-serif", size: 11, color: "#64676C"}}];
        const data = structuredClone(chart.data);
        await Plotly.newPlot(temporary, data, layout, {displayModeBar: false, staticPlot: true});
        const picks = [...new Set((chart._altitudeSeriesNames || data.filter(trace => trace.mode !== "text").map(trace => trace.name || "series")).map(slug))].join("-");
        const filename = `${slug(manifest.name)}-${picks}-${new Date().toISOString().slice(0, 10)}`;
        await Plotly.downloadImage(temporary, {format, width, height, scale, filename});
        message.textContent = "Image saved.";
      } catch (error) {
        message.textContent = "Could not save the image. Please try again.";
      } finally {
        Plotly.purge(temporary);
        temporary.remove();
        save.disabled = false;
      }
    });
    container.append(details);
  }
  window.AltitudeExport = {setup};
})();
