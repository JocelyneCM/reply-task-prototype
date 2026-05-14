/**
 * Field dictionary / metrics glossary for admin About view.
 * Read-only; loads JSON from static.
 */
(function () {
  "use strict";

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  const KIND_CLASS = {
    exact: "pex-fielddict-badge--exact",
    heuristic: "pex-fielddict-badge--heuristic",
    legacy: "pex-fielddict-badge--legacy",
  };

  const APPEAR_LABELS = {
    raw_csv: "Raw CSV",
    study_export: "Study export (base)",
    study_export_advanced: "Study export (advanced)",
    admin_trial_detail: "Admin row detail",
    sidecar_json: "Sidecar JSON",
    "sidecar_json.metrics": "Sidecar → metrics",
    runs_csv: "Runs CSV",
  };

  function appearTags(list) {
    return (list || [])
      .map((k) => {
        const lab = APPEAR_LABELS[k] || k;
        return `<span class="pex-fielddict-tag">${esc(lab)}</span>`;
      })
      .join("");
  }

  function entryHtml(e) {
    const names = (e.fieldNames || []).map((n) => `<code>${esc(n)}</code>`).join(" · ");
    const k = e.kind || "exact";
    const kc = KIND_CLASS[k] || KIND_CLASS.exact;
    const caveats = e.caveats
      ? `<p class="pex-fielddict-caveat"><strong>Limitations:</strong> ${esc(e.caveats)}</p>`
      : "";
    const ex = e.example
      ? `<p class="pex-fielddict-example"><strong>Example:</strong> <code class="pex-fielddict-example-code">${esc(e.example)}</code></p>`
      : "";
    const hay = [
      names,
      e.label || "",
      e.explanation || "",
      e.caveats || "",
      e.example || "",
      (e.fieldNames || []).join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return `<article class="pex-fielddict-entry" data-fielddict-hay="${esc(hay)}">
      <div class="pex-fielddict-entry-head">
        <span class="pex-fielddict-badge ${kc}">${esc(k)}</span>
        <h4 class="pex-fielddict-entry-title">${esc(e.label || (e.fieldNames || [])[0] || "")}</h4>
      </div>
      <p class="pex-fielddict-names">${names}</p>
      <div class="pex-fielddict-appear">${appearTags(e.appearsIn)}</div>
      <p class="pex-fielddict-expl">${esc(e.explanation || "")}</p>
      ${caveats}
      ${ex}
    </article>`;
  }

  function categoryHtml(cat, idx) {
    const inner = (cat.entries || []).map(entryHtml).join("");
    const openAttr = idx === 0 ? " open" : "";
    return `<details class="pex-fielddict-cat"${openAttr}>
      <summary class="pex-fielddict-cat-sum"><span>${esc(cat.title || cat.id)}</span><span class="pex-fielddict-cat-count">${(cat.entries || []).length}</span></summary>
      <div class="pex-fielddict-cat-body">${inner}</div>
    </details>`;
  }

  function render(data, root, statusEl) {
    const intro = data.intro || "";
    const cats = data.categories || [];
    root.innerHTML = `<p class="pex-fielddict-intro">${esc(intro)}</p>
      <div class="pex-fielddict-cats">${cats.map((c, i) => categoryHtml(c, i)).join("")}</div>`;
    if (statusEl) statusEl.textContent = `${cats.length} categories · ${cats.reduce((n, c) => n + (c.entries || []).length, 0)} entries`;
  }

  function filter(root, q) {
    const needle = (q || "").trim().toLowerCase();
    root.querySelectorAll(".pex-fielddict-entry").forEach((el) => {
      const hay = (el.getAttribute("data-fielddict-hay") || "").toLowerCase();
      el.classList.toggle("pex-fielddict-entry--hidden", needle && !hay.includes(needle));
    });
    root.querySelectorAll(".pex-fielddict-cat").forEach((det) => {
      const visible = det.querySelectorAll(
        ".pex-fielddict-entry:not(.pex-fielddict-entry--hidden)"
      ).length;
      det.classList.toggle("pex-fielddict-cat--empty", visible === 0);
    });
  }

  function init() {
    const mount = document.getElementById("fieldDictionaryMount");
    if (!mount) return;
    const body = document.getElementById("fieldDictionaryBody");
    const search = document.getElementById("fieldDictionarySearch");
    const status = document.getElementById("fieldDictionaryStatus");
    if (!body) return;

    body.innerHTML = '<p class="small" style="color:var(--muted)">Loading glossary…</p>';

    fetch("/static/data/field_dictionary.json", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        body.innerHTML = "";
        render(data, body, status);
        if (search) {
          search.addEventListener("input", () => filter(body, search.value));
        }
      })
      .catch(() => {
        body.innerHTML =
          '<p class="small" style="color:var(--muted)">Could not load field dictionary. Check that <code>static/data/field_dictionary.json</code> exists.</p>';
        if (status) status.textContent = "";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
