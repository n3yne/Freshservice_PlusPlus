// The first-start plugin picker: MSP++ comes with no plugins, so when no site
// plugin is installed (a new install, or an update from a version that bundled
// Freshservice) the main window asks which site plugin(s) and which optional
// plugins to install from the plugin directory. Installing restarts the app.
//
// main.js decides whether to open it (plugin-setup-status) and does the work
// (plugin-setup-refresh / -install / -skip / -restart). The plugin lists below
// are kept free of the DOM so the tests can require this file.
(function (root) {
  "use strict";

  // Directory entries, split into site plugins and the rest (grouped by category).
  //   plugins    plugin-directory getState().plugins
  //   preselect  ids to tick (plugins that were in use before the update)
  function buildChoices(plugins, preselect, Categories) {
    const list = (Array.isArray(plugins) ? plugins : []).filter(function (p) {
      return p && p.status !== "installed" && p.status !== "update";
    });
    const isSite = function (p) { return p.site === true || p.category === "Sites"; };
    const sites = list.filter(isSite).sort(function (a, b) { return a.name.localeCompare(b.name); });
    const others = list.filter(function (p) { return !isSite(p); });
    const groups = Categories && typeof Categories.groupPlugins === "function"
      ? Categories.groupPlugins(others)
      : [{ name: "Plugins", plugins: others.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }) }];
    const selected = new Set();
    const pre = Array.isArray(preselect) ? preselect : [];
    for (const p of list) {
      if (pre.includes(p.id) && p.compatible !== false) selected.add(p.id);
    }
    return { sites: sites, groups: groups, selected: closeOver(selected, list) };
  }

  // Adds everything the ticked plugins require (when it's in the list).
  function closeOver(selected, list) {
    const byId = new Map(list.map(function (p) { return [p.id, p]; }));
    const out = new Set(selected);
    const queue = Array.from(out);
    while (queue.length) {
      const p = byId.get(queue.shift());
      for (const r of (p && p.requires) || []) {
        if (byId.has(r) && !out.has(r)) { out.add(r); queue.push(r); }
      }
    }
    return out;
  }

  // Ticking a plugin ticks what it needs; unticking one unticks what needs it.
  function toggle(selected, id, on, list) {
    let out = new Set(selected);
    if (on) {
      out.add(id);
      out = closeOver(out, list);
    } else {
      out.delete(id);
      let changed = true;
      while (changed) {
        changed = false;
        for (const p of list) {
          if (out.has(p.id) && (p.requires || []).some(function (r) { return !out.has(r) && list.some(function (x) { return x.id === r; }); })) {
            out.delete(p.id);
            changed = true;
          }
        }
      }
    }
    return out;
  }

  // Names of what a plugin needs, for "Also installs …".
  function requiredNames(plugin, list) {
    return (plugin.requires || []).map(function (r) {
      const p = list.find(function (x) { return x.id === r; });
      return p ? p.name : null;
    }).filter(Boolean);
  }

  const api = { buildChoices: buildChoices, toggle: toggle, requiredNames: requiredNames };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.SetupPicker = api;

  // ==================== The dialog ====================

  const backup = root.backupAPI;
  if (!backup || typeof backup.getPluginSetup !== "function") return;

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  let status = null;      // from plugin-setup-status
  let entries = [];       // every directory entry offered
  let selected = new Set();
  const imported = [];    // names imported from files, waiting for restart
  let busy = false;

  const overlay = document.getElementById("plugin-setup");
  if (!overlay) return;
  const intro = document.getElementById("plugin-setup-intro");
  const body = document.getElementById("plugin-setup-list");
  const message = document.getElementById("plugin-setup-message");
  const btnInstall = document.getElementById("plugin-setup-install");
  const btnSkip = document.getElementById("plugin-setup-skip");
  const btnFile = document.getElementById("plugin-setup-file");
  const dontAsk = document.getElementById("plugin-setup-dont-ask");

  function setMessage(text, kind) {
    message.textContent = text || "";
    message.className = "plugin-setup-message" + (kind ? " " + kind : "");
  }

  function updateFooter() {
    const n = selected.size;
    if (n > 0) btnInstall.textContent = n === 1 ? "Install 1 plugin" : "Install " + n + " plugins";
    else btnInstall.textContent = imported.length ? "Restart now" : "Install";
    btnInstall.disabled = busy || (n === 0 && imported.length === 0);
    btnSkip.disabled = busy;
    btnFile.disabled = busy;
    const siteTicked = entries.some(function (p) { return (p.site === true || p.category === "Sites") && selected.has(p.id); });
    if (!busy && !message.classList.contains("error")) {
      if (imported.length) setMessage("Imported " + imported.join(", ") + ". It loads when MSP++ restarts.");
      else if (entries.length && !siteTicked) setMessage("Without a site plugin, MSP++ works as a plain tabbed browser.", "hint");
      else setMessage("");
    }
  }

  function row(p) {
    const label = el("label", "plugin-setup-row");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selected.has(p.id);
    box.disabled = busy || p.compatible === false;
    box.addEventListener("change", function () {
      selected = toggle(selected, p.id, box.checked, entries);
      if (message.classList.contains("error")) setMessage("");
      render();
    });
    label.appendChild(box);
    const text = el("span", "plugin-setup-text");
    const title = el("span", "plugin-setup-name", p.name);
    if (p.version) title.appendChild(el("span", "plugin-setup-version", " v" + p.version));
    text.appendChild(title);
    if (p.description) text.appendChild(el("span", "plugin-setup-desc", p.description));
    const needs = requiredNames(p, entries);
    if (p.compatible === false) {
      text.appendChild(el("span", "plugin-setup-note", "Needs a newer version of MSP++" + (p.minAppVersion ? " (" + p.minAppVersion + ")" : "")));
    } else if (needs.length) {
      text.appendChild(el("span", "plugin-setup-note", "Also installs " + needs.join(", ")));
    }
    label.appendChild(text);
    return label;
  }

  function section(title, hint, plugins) {
    const wrap = el("section", "plugin-setup-section");
    const head = el("h3", "plugin-setup-heading", title);
    if (hint) head.appendChild(el("span", "plugin-setup-heading-hint", hint));
    wrap.appendChild(head);
    for (const p of plugins) wrap.appendChild(row(p));
    return wrap;
  }

  let choices = null;

  function render() {
    body.replaceChildren();
    if (!choices) return;
    if (choices.sites.length) {
      body.appendChild(section("Sites", "Pick the site(s) you work in", choices.sites));
    }
    const groups = choices.groups.filter(function (g) { return g.plugins.length; });
    if (groups.length) {
      body.appendChild(el("h2", "plugin-setup-part", "Optional plugins"));
      for (const g of groups) body.appendChild(section(g.name, "", g.plugins));
    }
    updateFooter();
  }

  function showLoading(text) {
    body.replaceChildren(el("div", "plugin-setup-loading", text));
  }

  function showOffline(error) {
    body.replaceChildren();
    const box = el("div", "plugin-setup-offline");
    box.appendChild(el("p", "plugin-setup-offline-title", "Couldn't reach the plugin directory"));
    const hint = "Check the internet connection and try again.";
    // Network errors come through as Chromium codes such as net::ERR_INTERNET_DISCONNECTED.
    const detail = !error ? hint : /^net::/.test(error) ? hint + " (" + error + ")" : error;
    box.appendChild(el("p", "plugin-setup-offline-detail", detail));
    box.appendChild(el("p", "plugin-setup-offline-detail",
      "You can also install a plugin from a .mspplugin file, or skip for now and install plugins later from Settings > Plugins > Browse."));
    const retry = el("button", "btn btn-primary", "Try again");
    retry.type = "button";
    retry.addEventListener("click", load);
    box.appendChild(retry);
    body.appendChild(box);
    updateFooter();
  }

  async function load() {
    showLoading("Loading the plugin directory…");
    setMessage("");
    let state;
    try {
      state = await backup.refreshPluginSetup();
    } catch (err) {
      showOffline(err && err.message);
      return;
    }
    if (!state || (state.error && !(state.plugins || []).length)) {
      showOffline(state && state.error);
      return;
    }
    // On an update, keep ticks the user already changed on a retry.
    const keep = choices ? Array.from(selected) : status.preselect;
    choices = buildChoices(state.plugins, keep, root.PluginCategories);
    entries = [].concat(choices.sites, ...choices.groups.map(function (g) { return g.plugins; }));
    selected = choices.selected;
    if (!entries.length) {
      body.replaceChildren(el("div", "plugin-setup-loading", "The plugin directory is empty right now."));
      updateFooter();
      return;
    }
    render();
  }

  function setBusy(on) {
    busy = on;
    for (const box of body.querySelectorAll("input[type=checkbox]")) box.disabled = on;
    updateFooter();
  }

  btnInstall.addEventListener("click", async function () {
    if (busy) return;
    if (selected.size === 0) {
      if (imported.length) {
        setBusy(true);
        setMessage("Restarting MSP++…");
        backup.restartAfterPluginSetup();
      }
      return;
    }
    setBusy(true);
    setMessage("Downloading " + (selected.size === 1 ? "1 plugin" : selected.size + " plugins") + "…");
    let result;
    try {
      result = await backup.installPluginSetup(Array.from(selected));
    } catch (err) {
      result = { success: false, error: (err && err.message) || String(err) };
    }
    if (result && result.success) {
      setMessage("Installed. Restarting MSP++…", "ok");
      return; // main.js restarts the app
    }
    busy = false;
    setMessage((result && result.error) || "The plugins couldn't be installed.", "error");
    render();
  });

  btnSkip.addEventListener("click", async function () {
    if (busy) return;
    setBusy(true);
    try { await backup.skipPluginSetup(dontAsk.checked); } catch { /* close anyway */ }
    overlay.classList.remove("visible");
  });

  btnFile.addEventListener("click", async function () {
    if (busy) return;
    setBusy(true);
    let result;
    try { result = await backup.importPlugin("file"); } catch (err) { result = { success: false, error: err && err.message }; }
    busy = false;
    if (result && result.success) {
      imported.push(result.name || result.id);
      setMessage("");
    } else if (result && !result.cancelled) {
      setMessage((result && result.error) || "That file couldn't be imported.", "error");
    }
    if (choices) render(); else updateFooter();
  });

  async function start() {
    try {
      status = await backup.getPluginSetup();
    } catch {
      return;
    }
    if (!status || !status.show) return;
    intro.textContent = status.existingInstall
      ? "MSP++ no longer comes with plugins built in, so choose the ones to install. The ones you were using are already ticked, and your settings, notes and other data are kept."
      : "MSP++ works through plugins. Choose the site you work in and any extras you'd like. You can add or remove plugins any time in Settings > Plugins.";
    overlay.classList.add("visible");
    load();
  }

  start();
})(typeof window !== "undefined" ? window : globalThis);
