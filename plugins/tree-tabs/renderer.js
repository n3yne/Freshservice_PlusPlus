// Tree Style Tabs plugin — main window renderer
// A "Tree" tab in the side panel that shows the open tabs as a tree:
//   - Groups are named folders that hold tabs (and other groups).
//   - Any tab can be a "master" tab with child tabs under it.
//   - Nesting goes as deep as you like. Drag a row onto another to nest it
//     (middle of the row), or above/below it to put it next to it.
//   - Tabs opened from a link in a tab go under that tab (a setting).
//   - Closing a tab moves its children up a level, in its place.
// The tree is saved in the plugin's data folder and matched to the restored
// tabs by address when the app starts. The tab bar itself isn't reordered.
(function () {
  "use strict";

  // ---------- tree model (no DOM, also loaded by the tests) ----------

  const MAX_NAME = 200;
  const MAX_DEPTH = 64;

  function createTree() {
    const nodes = new Map(); // id → { id, kind, tabId, name, collapsed, parentId, children }
    const roots = [];
    const byTab = new Map(); // tabId → node id
    let seq = 0;

    function newId() { seq += 1; return "n" + seq; }
    function get(id) { return nodes.get(id) || null; }
    function siblingsOf(node) { return node.parentId ? nodes.get(node.parentId).children : roots; }
    function listFor(parentId) {
      if (!parentId) return roots;
      const p = nodes.get(parentId);
      return p ? p.children : null;
    }

    function depthOf(id) {
      let d = 0;
      let n = nodes.get(id);
      while (n && n.parentId) { d += 1; n = nodes.get(n.parentId); }
      return d;
    }

    // Height of the subtree under id (0 for a leaf).
    function heightOf(id) {
      const n = nodes.get(id);
      let h = 0;
      n.children.forEach(function (c) { h = Math.max(h, 1 + heightOf(c)); });
      return h;
    }

    // Whether a is b or one of b's ancestors.
    function isAncestorOrSelf(a, b) {
      let n = nodes.get(b);
      while (n) {
        if (n.id === a) return true;
        n = n.parentId ? nodes.get(n.parentId) : null;
      }
      return false;
    }

    function ancestors(id) {
      const out = [];
      let n = nodes.get(id);
      while (n && n.parentId) { out.push(n.parentId); n = nodes.get(n.parentId); }
      return out;
    }

    function insert(node, parentId, index) {
      let list = listFor(parentId);
      if (!list) { parentId = null; list = roots; }
      node.parentId = parentId || null;
      const i = typeof index === "number" && index >= 0 && index <= list.length ? index : list.length;
      list.splice(i, 0, node.id);
    }

    function detach(node) {
      const list = siblingsOf(node);
      const i = list.indexOf(node.id);
      if (i !== -1) list.splice(i, 1);
      return i;
    }

    function addTab(tabId, opts) {
      if (byTab.has(tabId)) return nodes.get(byTab.get(tabId));
      opts = opts || {};
      const node = { id: newId(), kind: "tab", tabId: tabId, name: cleanName(opts.name), collapsed: !!opts.collapsed, parentId: null, children: [] };
      nodes.set(node.id, node);
      byTab.set(tabId, node.id);
      let parentId = opts.parentId || null;
      if (parentId && depthOf(parentId) >= MAX_DEPTH) parentId = nodes.get(parentId).parentId;
      insert(node, parentId, opts.index);
      return node;
    }

    function addGroup(name, opts) {
      opts = opts || {};
      const node = { id: newId(), kind: "group", tabId: null, name: cleanName(name) || "New group", collapsed: !!opts.collapsed, parentId: null, children: [] };
      nodes.set(node.id, node);
      let parentId = opts.parentId || null;
      if (parentId && depthOf(parentId) >= MAX_DEPTH) parentId = nodes.get(parentId).parentId;
      insert(node, parentId, opts.index);
      return node;
    }

    // Removes one node. Its children take its place in its parent, in order.
    function remove(id) {
      const node = nodes.get(id);
      if (!node) return false;
      const list = siblingsOf(node);
      const i = detach(node);
      const kids = node.children.slice();
      kids.forEach(function (c) { nodes.get(c).parentId = node.parentId; });
      list.splice(i === -1 ? list.length : i, 0, ...kids);
      nodes.delete(id);
      if (node.tabId) byTab.delete(node.tabId);
      return true;
    }

    // Removes a node and everything under it.
    function removeSubtree(id) {
      const node = nodes.get(id);
      if (!node) return false;
      detach(node);
      (function drop(n) {
        n.children.forEach(function (c) { drop(nodes.get(c)); });
        nodes.delete(n.id);
        if (n.tabId) byTab.delete(n.tabId);
      })(node);
      return true;
    }

    function removeTab(tabId) {
      const id = byTab.get(tabId);
      return id ? remove(id) : false;
    }

    // position: "before" | "after" | "inside" (last child) | "first" (first child).
    // Returns false when the move isn't possible (onto itself or one of its own children).
    function move(id, targetId, position) {
      const node = nodes.get(id);
      if (!node) return false;
      if (!targetId) {
        detach(node);
        insert(node, null, position === "first" ? 0 : undefined);
        return true;
      }
      const target = nodes.get(targetId);
      if (!target || isAncestorOrSelf(id, targetId)) return false;
      const into = position === "inside" || position === "first";
      const newDepth = (into ? depthOf(targetId) + 1 : depthOf(targetId)) + heightOf(id);
      if (newDepth > MAX_DEPTH) return false;
      detach(node);
      if (into) {
        insert(node, targetId, position === "first" ? 0 : undefined);
      } else {
        const list = siblingsOf(target);
        const i = list.indexOf(targetId);
        insert(node, target.parentId, position === "after" ? i + 1 : i);
      }
      return true;
    }

    // Moves a node up one level, just after its parent.
    function outdent(id) {
      const node = nodes.get(id);
      if (!node || !node.parentId) return false;
      return move(id, node.parentId, "after");
    }

    // Puts a new group where the node is and moves the node into it.
    function wrapInGroup(id, name) {
      const node = nodes.get(id);
      if (!node) return null;
      const i = siblingsOf(node).indexOf(id);
      const group = addGroup(name, { parentId: node.parentId, index: i });
      move(id, group.id, "inside");
      return group;
    }

    // Every node under id, depth first (not id itself).
    function descendants(id) {
      const out = [];
      (function walk(list) {
        list.forEach(function (c) { out.push(c); walk(nodes.get(c).children); });
      })(nodes.get(id) ? nodes.get(id).children : []);
      return out;
    }

    // Depth-first list of { node, depth }. With visibleOnly, children of
    // collapsed nodes are left out.
    function flatten(visibleOnly) {
      const out = [];
      (function walk(list, depth) {
        list.forEach(function (id) {
          const n = nodes.get(id);
          out.push({ node: n, depth: depth });
          if (!(visibleOnly && n.collapsed)) walk(n.children, depth + 1);
        });
      })(roots, 0);
      return out;
    }

    // tabInfo(tabId) → { url, index } of the tab now, or null to leave it out
    // (its children move up a level).
    function serialize(tabInfo) {
      const entries = [];
      (function walk(list, depth) {
        list.forEach(function (id) {
          const n = nodes.get(id);
          const d = depth;
          if (n.kind === "tab") {
            const info = tabInfo(n.tabId);
            if (!info || typeof info.url !== "string" || !info.url) { walk(n.children, depth); return; }
            entries.push({ kind: "tab", depth: d, name: n.name, collapsed: n.collapsed, url: info.url.slice(0, 4096), index: info.index });
          } else {
            entries.push({ kind: "group", depth: d, name: n.name, collapsed: n.collapsed });
          }
          walk(n.children, d + 1);
        });
      })(roots, 0);
      return { version: 1, entries: entries };
    }

    return {
      nodes: nodes,
      roots: roots,
      get: get,
      nodeForTab: function (tabId) { const id = byTab.get(tabId); return id ? nodes.get(id) : null; },
      hasTab: function (tabId) { return byTab.has(tabId); },
      depthOf: depthOf,
      ancestors: ancestors,
      isAncestorOrSelf: isAncestorOrSelf,
      addTab: addTab,
      addGroup: addGroup,
      remove: remove,
      removeSubtree: removeSubtree,
      removeTab: removeTab,
      move: move,
      outdent: outdent,
      wrapInGroup: wrapInGroup,
      descendants: descendants,
      flatten: flatten,
      serialize: serialize,
    };
  }

  function cleanName(name) {
    return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
  }

  // Builds a tree from a saved state and the tabs open now ([{ tabId, url }], in
  // tab-bar order). Saved tabs are matched to open tabs with the same address,
  // in tab-bar order; a saved tab with no match is dropped and its children move
  // up a level. Open tabs that matched nothing go at the end, at the top level.
  function restore(state, liveTabs) {
    const tree = createTree();
    const entries = state && Array.isArray(state.entries) ? state.entries : [];
    const used = new Set();
    const matched = new Map(); // entry index → tabId

    entries
      .map(function (e, i) { return { e: e, i: i }; })
      .filter(function (x) { return x.e && x.e.kind === "tab"; })
      .sort(function (a, b) { return (a.e.index || 0) - (b.e.index || 0); })
      .forEach(function (x) {
        const live = liveTabs.find(function (t) { return !used.has(t.tabId) && t.url === x.e.url; });
        if (live) { used.add(live.tabId); matched.set(x.i, live.tabId); }
      });

    // stack[d] = id of the latest node placed at depth d (null when that level
    // was a dropped tab, whose children then attach to the level above).
    const stack = [];
    entries.forEach(function (e, i) {
      if (!e || (e.kind !== "tab" && e.kind !== "group")) return;
      const depth = Math.max(0, Math.min(Number(e.depth) || 0, stack.length));
      stack.length = depth;
      let parentId = null;
      for (let d = depth - 1; d >= 0; d--) { if (stack[d]) { parentId = stack[d]; break; } }
      let node = null;
      if (e.kind === "group") {
        node = tree.addGroup(e.name, { parentId: parentId, collapsed: e.collapsed === true });
      } else if (matched.has(i)) {
        node = tree.addTab(matched.get(i), { parentId: parentId, name: e.name, collapsed: e.collapsed === true });
      }
      stack[depth] = node ? node.id : null;
    });

    liveTabs.forEach(function (t) { if (!tree.hasTab(t.tabId)) tree.addTab(t.tabId); });
    return tree;
  }

  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = { createTree: createTree, restore: restore, cleanName: cleanName, MAX_DEPTH: MAX_DEPTH };
    return;
  }

  // ---------- UI ----------

  const api = window.pluginAPI;
  if (!api || !api.ui || typeof api.ui.addSidePanelTab !== "function" || !api.browser.activateTab) return;

  let settings = api.getSettings();
  let tree = createTree();
  let ready = false; // the saved tree has been loaded
  const tabState = new Map(); // tabId → { title, url, pinned, favicon, webview, onFavicon }
  let activeTabId = null;
  let filterText = "";
  let renamingId = null;
  let dragId = null;

  const panelTab = api.ui.addSidePanelTab({ id: "tree-tabs", label: "Tree", icon: "🌲", title: "Tree Style Tabs", order: 30 });
  const root = panelTab.element;
  root.classList.add("tt-root");
  root.innerHTML =
    '<div class="tt-toolbar">' +
    '  <button type="button" class="tt-btn" data-tt="new-group" title="New group">＋ Group</button>' +
    '  <button type="button" class="tt-btn tt-icon-btn" data-tt="collapse-all" title="Collapse all">⊟</button>' +
    '  <button type="button" class="tt-btn tt-icon-btn" data-tt="expand-all" title="Expand all">⊞</button>' +
    '  <input type="search" class="tt-filter" placeholder="Filter tabs" maxlength="200" spellcheck="false" aria-label="Filter tabs" />' +
    "</div>" +
    '<div class="tt-list" role="tree" aria-label="Open tabs"></div>' +
    '<div class="tt-footer"></div>';
  const listEl = root.querySelector(".tt-list");
  const footerEl = root.querySelector(".tt-footer");
  const filterInput = root.querySelector(".tt-filter");

  // ---------- tabs ----------

  function isSafeIcon(url) {
    return typeof url === "string" && url.length < 100000 && /^(https?:|data:image\/)/i.test(url);
  }

  function track(info) {
    if (!info || !info.tabId) return;
    let st = tabState.get(info.tabId);
    if (!st) {
      st = { title: "", url: "", pinned: false, favicon: "", webview: info.webview, onFavicon: null };
      st.onFavicon = function (e) {
        const icon = e && Array.isArray(e.favicons) ? e.favicons.find(isSafeIcon) : null;
        st.favicon = icon || "";
        scheduleRender();
      };
      if (info.webview) info.webview.addEventListener("page-favicon-updated", st.onFavicon);
      tabState.set(info.tabId, st);
    }
    if (typeof info.title === "string") st.title = info.title;
    if (typeof info.url === "string") {
      if (st.url && st.url !== info.url) {
        try { if (new URL(st.url).origin !== new URL(info.url).origin) st.favicon = ""; } catch { st.favicon = ""; }
      }
      st.url = info.url;
    }
    if (typeof info.pinned === "boolean") st.pinned = info.pinned;
    if (info.active) activeTabId = info.tabId;
  }

  function untrack(tabId) {
    const st = tabState.get(tabId);
    if (st && st.webview && st.onFavicon) {
      try { st.webview.removeEventListener("page-favicon-updated", st.onFavicon); } catch { /* removed */ }
    }
    tabState.delete(tabId);
  }

  function tabTitle(tabId) {
    const st = tabState.get(tabId);
    if (!st) return "Tab";
    if (st.title && st.title !== "Loading...") return st.title;
    try { return new URL(st.url).hostname || st.title || "New tab"; } catch { return st.title || "New tab"; }
  }

  function liveTabs() {
    return api.browser.getTabs().map(function (t) { track(t); return { tabId: t.tabId, url: t.url }; });
  }

  // Tab ids of every tab node under id (and id itself if it is a tab).
  function tabsUnder(id, includeSelf) {
    const ids = (includeSelf ? [id] : []).concat(tree.descendants(id));
    return ids.map(function (n) { return tree.get(n); }).filter(function (n) { return n && n.kind === "tab"; }).map(function (n) { return n.tabId; });
  }

  // ---------- saving ----------

  let saveTimer = null;
  function snapshot() {
    const order = api.browser.getTabs();
    return tree.serialize(function (tabId) {
      const i = order.findIndex(function (t) { return t.tabId === tabId; });
      if (i === -1) return null;
      const url = order[i].url;
      return /^https?:/i.test(url) ? { url: url, index: i } : null;
    });
  }
  function scheduleSave() {
    if (!ready) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      api.invoke("tree-tabs", "save-state", snapshot()).catch(function (err) { console.error("[Tree Tabs] Save failed:", err); });
    }, 800);
  }
  window.addEventListener("beforeunload", function () {
    if (!ready) return;
    clearTimeout(saveTimer);
    api.send("tree-tabs", "save-state-now", snapshot());
  });

  function changed() {
    scheduleRender();
    scheduleSave();
  }

  // ---------- rendering ----------

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; render(); });
  }

  function matchesFilter(node) {
    if (!filterText) return true;
    const hay = (node.kind === "tab" ? node.name + " " + tabTitle(node.tabId) + " " + ((tabState.get(node.tabId) || {}).url || "") : node.name).toLowerCase();
    return hay.indexOf(filterText) !== -1;
  }

  // Re-renders the list, keeping focus on the same row (keyboard use).
  function render() {
    if (renamingId) return; // don't wipe the rename box; rendered when it closes
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest(".tt-row");
    const focusId = focused && listEl.contains(focused) ? focused.dataset.id : null;
    renderList();
    if (focusId) {
      const row = listEl.querySelector('.tt-row[data-id="' + focusId + '"]');
      if (row) row.focus({ preventScroll: true });
    }
  }

  function renderList() {
    const frag = document.createDocumentFragment();
    let rows;
    if (filterText) {
      // Show matches and the groups/tabs above them, all expanded.
      const keep = new Set();
      tree.flatten(false).forEach(function (r) {
        if (matchesFilter(r.node)) { keep.add(r.node.id); tree.ancestors(r.node.id).forEach(function (a) { keep.add(a); }); }
      });
      rows = tree.flatten(false).filter(function (r) { return keep.has(r.node.id); });
    } else {
      rows = tree.flatten(true);
    }
    const activeNode = activeTabId ? tree.nodeForTab(activeTabId) : null;
    const activeAncestors = new Set(activeNode ? tree.ancestors(activeNode.id) : []);

    rows.forEach(function (r) { frag.appendChild(renderRow(r.node, r.depth, activeNode, activeAncestors)); });

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tt-empty";
      empty.textContent = filterText ? "No tabs match." : "No tabs open.";
      frag.appendChild(empty);
    }

    listEl.replaceChildren(frag);
    const tabCount = tabState.size;
    let groups = 0;
    tree.nodes.forEach(function (n) { if (n.kind === "group") groups += 1; });
    footerEl.textContent = tabCount + (tabCount === 1 ? " tab" : " tabs") + (groups ? " · " + groups + (groups === 1 ? " group" : " groups") : "");
  }

  function renderRow(node, depth, activeNode, activeAncestors) {
    const row = document.createElement("div");
    row.className = "tt-row tt-" + node.kind;
    row.dataset.id = node.id;
    row.draggable = true;
    row.tabIndex = 0;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(depth + 1));
    row.style.setProperty("--tt-depth", String(depth));
    const hasKids = node.children.length > 0;
    if (hasKids) row.setAttribute("aria-expanded", node.collapsed && !filterText ? "false" : "true");
    if (activeNode && activeNode.id === node.id) { row.classList.add("tt-active"); row.setAttribute("aria-selected", "true"); }
    if (node.collapsed && activeAncestors.has(node.id)) row.classList.add("tt-has-active");

    const twisty = document.createElement("span");
    twisty.className = "tt-twisty";
    if (hasKids) {
      twisty.textContent = node.collapsed && !filterText ? "▸" : "▾";
      twisty.dataset.tt = "toggle";
      twisty.title = node.collapsed ? "Expand" : "Collapse";
    }
    row.appendChild(twisty);

    const icon = document.createElement("span");
    icon.className = "tt-icon";
    const st = node.kind === "tab" ? tabState.get(node.tabId) : null;
    if (node.kind === "group") {
      icon.textContent = node.collapsed && hasKids ? "📁" : "📂";
    } else if (st && st.favicon) {
      const img = document.createElement("img");
      img.src = st.favicon;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", function () { img.remove(); icon.textContent = "🌐"; }, { once: true });
      icon.appendChild(img);
    } else {
      icon.textContent = "🌐";
    }
    row.appendChild(icon);

    const label = document.createElement("span");
    label.className = "tt-label";
    if (node.kind === "group") {
      label.textContent = node.name || "New group";
      row.title = (node.name || "New group") + " — double-click to rename";
    } else {
      const title = tabTitle(node.tabId);
      label.textContent = node.name || title;
      row.title = (node.name ? node.name + " — " : "") + title + (st && st.url ? "\n" + st.url : "");
    }
    row.appendChild(label);

    if (hasKids && (node.collapsed || node.kind === "group")) {
      const count = document.createElement("span");
      count.className = "tt-count";
      const n = tabsUnder(node.id, false).length;
      count.textContent = String(n);
      count.title = n + (n === 1 ? " tab" : " tabs");
      row.appendChild(count);
    }

    if (node.kind === "tab" && st && st.pinned) {
      const pin = document.createElement("span");
      pin.className = "tt-pin";
      pin.textContent = "📌";
      pin.title = "Pinned";
      row.appendChild(pin);
    } else {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "tt-close";
      close.dataset.tt = "close";
      close.tabIndex = -1;
      close.textContent = "×";
      close.title = node.kind === "group" ? "Close the tabs in this group" : "Close tab";
      row.appendChild(close);
    }
    return row;
  }

  // ---------- actions ----------

  function activateNode(node) {
    if (node.kind === "tab") api.browser.activateTab(node.tabId);
  }

  function toggle(node, force) {
    if (!node.children.length) return;
    node.collapsed = typeof force === "boolean" ? force : !node.collapsed;
    changed();
  }

  function setAllCollapsed(collapsed) {
    tree.nodes.forEach(function (n) { if (n.children.length) n.collapsed = collapsed; });
    changed();
  }

  async function closeTabs(tabIds, what) {
    const closable = tabIds.filter(function (id) { const st = tabState.get(id); return st && !st.pinned; });
    if (closable.length > 1) {
      const ok = await api.ui.confirm("Close " + closable.length + " tabs" + (what ? " in " + what : "") + "?");
      if (!ok) return false;
    }
    closable.forEach(function (id) { api.browser.closeTab(id); });
    return true;
  }

  async function closeNode(node, withChildren) {
    if (node.kind === "tab" && !withChildren) {
      api.browser.closeTab(node.tabId);
      return;
    }
    const ids = tabsUnder(node.id, true);
    const name = node.kind === "group" ? "“" + (node.name || "New group") + "”" : "";
    if (!(await closeTabs(ids, name))) return;
    // Drop the group (and empty subgroups) once its tabs are gone; pinned tabs stay, moved up.
    if (node.kind === "group" && tree.get(node.id)) {
      tree.descendants(node.id).reverse().forEach(function (id) {
        const n = tree.get(id);
        if (n && n.kind === "group" && n.children.length === 0) tree.remove(id);
      });
      tree.remove(node.id);
      changed();
    }
  }

  function newGroup(opts) {
    const g = tree.addGroup("New group", opts || {});
    changed();
    panelTab.activate();
    // Start renaming once the row is on screen.
    requestAnimationFrame(function () { requestAnimationFrame(function () { startRename(g.id); }); });
    return g;
  }

  function wrapInGroup(node) {
    const g = tree.wrapInGroup(node.id, "New group");
    if (!g) return;
    changed();
    panelTab.activate();
    requestAnimationFrame(function () { requestAnimationFrame(function () { startRename(g.id); }); });
  }

  function startRename(id) {
    const node = tree.get(id);
    if (!node) return;
    if (renamingId) finishRename(true);
    render();
    const row = listEl.querySelector('.tt-row[data-id="' + id + '"]');
    if (!row) return;
    const label = row.querySelector(".tt-label");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tt-rename";
    input.maxLength = MAX_NAME;
    input.value = node.name || (node.kind === "group" ? "New group" : "");
    input.placeholder = node.kind === "tab" ? tabTitle(node.tabId) : "Group name";
    input.setAttribute("aria-label", node.kind === "group" ? "Group name" : "Tab name");
    row.draggable = false;
    label.replaceWith(input);
    renamingId = id;
    input.focus();
    input.select();
    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finishRename(true); row.focus(); }
      else if (e.key === "Escape") { e.preventDefault(); finishRename(false); }
    });
    input.addEventListener("blur", function () { finishRename(true); });
    input.addEventListener("click", function (e) { e.stopPropagation(); });
    input.addEventListener("dblclick", function (e) { e.stopPropagation(); });
  }

  function finishRename(commit) {
    const id = renamingId;
    if (!id) return;
    const input = listEl.querySelector(".tt-rename");
    renamingId = null;
    const node = tree.get(id);
    if (node && commit && input) {
      const name = cleanName(input.value);
      node.name = node.kind === "group" ? (name || "New group") : name;
      scheduleSave();
    }
    render();
    const row = listEl.querySelector('.tt-row[data-id="' + id + '"]');
    if (row && commit === false) row.focus();
  }

  // ---------- context menu ----------

  let menuEl = null;
  function hideMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
  }

  function showMenu(x, y, items) {
    hideMenu();
    menuEl = document.createElement("div");
    menuEl.className = "tt-menu";
    menuEl.setAttribute("role", "menu");
    items.forEach(function (item) {
      if (item === "-") {
        const sep = document.createElement("div");
        sep.className = "tt-menu-sep";
        menuEl.appendChild(sep);
        return;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tt-menu-item";
      b.setAttribute("role", "menuitem");
      b.textContent = item.label;
      if (item.disabled) b.disabled = true;
      b.addEventListener("click", function () { hideMenu(); item.run(); });
      menuEl.appendChild(b);
    });
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + "px";
    menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + "px";
    const first = menuEl.querySelector("button:not([disabled])");
    if (first) first.focus();
  }

  document.addEventListener("mousedown", function (e) { if (menuEl && !menuEl.contains(e.target)) hideMenu(); }, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideMenu(); });
  window.addEventListener("blur", hideMenu);
  window.addEventListener("resize", hideMenu);

  function menuFor(node) {
    const items = [];
    if (node.kind === "tab") {
      const st = tabState.get(node.tabId);
      items.push({ label: "Switch to Tab", run: function () { activateNode(node); } });
      items.push({ label: node.name ? "Rename…" : "Name This Tab…", run: function () { startRename(node.id); } });
      if (node.name) items.push({ label: "Clear Name", run: function () { node.name = ""; changed(); } });
      items.push("-");
      items.push({ label: "Move to New Group", run: function () { wrapInGroup(node); } });
      items.push({ label: "Add Group Under This Tab", run: function () { newGroup({ parentId: node.id }); } });
      items.push({ label: "Move Up a Level", disabled: !node.parentId, run: function () { if (tree.outdent(node.id)) changed(); } });
      if (node.children.length) {
        items.push({ label: node.collapsed ? "Expand" : "Collapse", run: function () { toggle(node); } });
      }
      items.push("-");
      items.push({ label: "Close Tab", disabled: !!(st && st.pinned), run: function () { closeNode(node, false); } });
      if (node.children.length) items.push({ label: "Close Tab and Its Children", run: function () { closeNode(node, true); } });
    } else {
      items.push({ label: "Rename…", run: function () { startRename(node.id); } });
      items.push({ label: "Add Subgroup", run: function () { newGroup({ parentId: node.id }); } });
      if (activeTabId && tree.nodeForTab(activeTabId) && !tree.isAncestorOrSelf(tree.nodeForTab(activeTabId).id, node.id)) {
        items.push({ label: "Move Current Tab Here", run: function () { if (tree.move(tree.nodeForTab(activeTabId).id, node.id, "inside")) { node.collapsed = false; changed(); } } });
      }
      items.push({ label: "Move Up a Level", disabled: !node.parentId, run: function () { if (tree.outdent(node.id)) changed(); } });
      if (node.children.length) {
        items.push({ label: node.collapsed ? "Expand" : "Collapse", run: function () { toggle(node); } });
      }
      items.push("-");
      items.push({ label: "Ungroup (Keep Tabs)", run: function () { tree.remove(node.id); changed(); } });
      items.push({ label: "Close Group and Its Tabs", run: function () { closeNode(node, true); } });
    }
    return items;
  }

  // ---------- events on the list ----------

  function nodeFromEvent(e) {
    const row = e.target.closest && e.target.closest(".tt-row");
    return row ? tree.get(row.dataset.id) : null;
  }

  root.addEventListener("click", function (e) {
    const btn = e.target.closest("[data-tt]");
    const action = btn && btn.dataset.tt;
    if (action === "new-group") { newGroup(); return; }
    if (action === "collapse-all") { setAllCollapsed(true); return; }
    if (action === "expand-all") { setAllCollapsed(false); return; }
    const node = nodeFromEvent(e);
    if (!node) return;
    if (action === "toggle") { toggle(node); return; }
    if (action === "close") { closeNode(node, node.kind === "group"); return; }
    if (node.kind === "group") toggle(node);
    else activateNode(node);
  });

  listEl.addEventListener("dblclick", function (e) {
    const node = nodeFromEvent(e);
    if (!node || e.target.closest("[data-tt]")) return;
    if (node.kind === "group") { e.preventDefault(); startRename(node.id); }
  });

  // Middle-click closes a tab, like the tab bar.
  listEl.addEventListener("auxclick", function (e) {
    if (e.button !== 1) return;
    const node = nodeFromEvent(e);
    if (node && node.kind === "tab") { e.preventDefault(); closeNode(node, false); }
  });
  listEl.addEventListener("mousedown", function (e) { if (e.button === 1) e.preventDefault(); });

  listEl.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    const node = nodeFromEvent(e);
    if (node) showMenu(e.clientX, e.clientY, menuFor(node));
    else showMenu(e.clientX, e.clientY, [{ label: "New Group", run: function () { newGroup(); } }, { label: "Collapse All", run: function () { setAllCollapsed(true); } }, { label: "Expand All", run: function () { setAllCollapsed(false); } }]);
  });

  listEl.addEventListener("keydown", function (e) {
    const node = nodeFromEvent(e);
    if (!node || e.target.classList.contains("tt-rename")) return;
    const rows = Array.from(listEl.querySelectorAll(".tt-row"));
    const i = rows.indexOf(e.target.closest(".tt-row"));
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (node.kind === "group") toggle(node); else activateNode(node);
        break;
      case "ArrowDown":
        e.preventDefault();
        if (rows[i + 1]) rows[i + 1].focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (rows[i - 1]) rows[i - 1].focus();
        break;
      case "ArrowRight":
        e.preventDefault();
        if (node.children.length && node.collapsed) toggle(node, false);
        else if (rows[i + 1]) rows[i + 1].focus();
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (node.children.length && !node.collapsed) toggle(node, true);
        else if (node.parentId) {
          const p = listEl.querySelector('.tt-row[data-id="' + node.parentId + '"]');
          if (p) p.focus();
        }
        break;
      case "F2":
        e.preventDefault();
        startRename(node.id);
        break;
      case "Delete":
        e.preventDefault();
        closeNode(node, node.kind === "group");
        break;
      case "ContextMenu": {
        e.preventDefault();
        const r = e.target.getBoundingClientRect();
        showMenu(r.left + 16, r.bottom, menuFor(node));
        break;
      }
    }
  });
  filterInput.addEventListener("input", function () {
    filterText = filterInput.value.trim().toLowerCase();
    render();
  });
  filterInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && filterInput.value) { e.stopPropagation(); filterInput.value = ""; filterText = ""; render(); }
  });

  // ---------- drag and drop ----------
  // Drop on the top quarter of a row: before it. Bottom quarter: after it.
  // Middle: inside it (as its last child). Below the last row: top level, at the end.

  function clearDrop() {
    listEl.querySelectorAll(".tt-drop-before, .tt-drop-after, .tt-drop-inside").forEach(function (el) {
      el.classList.remove("tt-drop-before", "tt-drop-after", "tt-drop-inside");
    });
    listEl.classList.remove("tt-drop-end");
  }

  function dropPosition(e, row) {
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    if (y < 0.25) return "before";
    if (y > 0.75) return "after";
    return "inside";
  }

  listEl.addEventListener("dragstart", function (e) {
    const row = e.target.closest(".tt-row");
    if (!row || renamingId) { e.preventDefault(); return; }
    dragId = row.dataset.id;
    row.classList.add("tt-dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", tree.get(dragId) ? (tree.get(dragId).name || "tab") : ""); } catch { /* ignore */ }
  });

  listEl.addEventListener("dragend", function () {
    dragId = null;
    listEl.querySelectorAll(".tt-dragging").forEach(function (el) { el.classList.remove("tt-dragging"); });
    clearDrop();
  });

  listEl.addEventListener("dragover", function (e) {
    if (!dragId) return;
    const row = e.target.closest(".tt-row");
    clearDrop();
    if (!row) {
      e.preventDefault();
      listEl.classList.add("tt-drop-end");
      return;
    }
    const targetId = row.dataset.id;
    if (tree.isAncestorOrSelf(dragId, targetId)) { e.dataTransfer.dropEffect = "none"; return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    row.classList.add("tt-drop-" + dropPosition(e, row));
  });

  listEl.addEventListener("dragleave", function (e) {
    if (!listEl.contains(e.relatedTarget)) clearDrop();
  });

  listEl.addEventListener("drop", function (e) {
    if (!dragId) return;
    e.preventDefault();
    const row = e.target.closest(".tt-row");
    const id = dragId;
    clearDrop();
    let moved;
    if (!row) {
      moved = tree.move(id, null);
    } else {
      const target = tree.get(row.dataset.id);
      const pos = dropPosition(e, row);
      moved = tree.move(id, target.id, pos);
      if (moved && pos === "inside") target.collapsed = false;
    }
    if (moved) changed();
  });

  // ---------- tab events ----------

  function reveal(tabId) {
    const node = tree.nodeForTab(tabId);
    if (!node) return false;
    let opened = false;
    tree.ancestors(node.id).forEach(function (a) {
      const n = tree.get(a);
      if (n.collapsed) { n.collapsed = false; opened = true; }
    });
    return opened;
  }

  api.events.on("tab:created", function (info) {
    track(info);
    if (!ready) return;
    let parentId = null;
    if (info.openerTabId && settings.treeTabsNestOpened !== false) {
      const opener = tree.nodeForTab(info.openerTabId);
      if (opener) parentId = opener.id;
    }
    tree.addTab(info.tabId, { parentId: parentId });
    if (info.active || info.tabId === activeTabId) reveal(info.tabId);
    changed();
  });

  api.events.on("tab:closed", function (info) {
    untrack(info.tabId);
    if (activeTabId === info.tabId) activeTabId = null;
    if (!ready) return;
    tree.removeTab(info.tabId);
    changed();
  });

  api.events.on("tab:activated", function (info) {
    track(info);
    activeTabId = info.tabId;
    if (!ready) return;
    if (reveal(info.tabId)) scheduleSave();
    scheduleRender();
    if (panelTab.isActive()) {
      requestAnimationFrame(function () {
        const node = tree.nodeForTab(info.tabId);
        const row = node && listEl.querySelector('.tt-row[data-id="' + node.id + '"]');
        if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
      });
    }
  });

  api.events.on("tab:updated", function (info) {
    const st = tabState.get(info.tabId);
    const urlChanged = !st || st.url !== info.url;
    track(info);
    scheduleRender();
    if (urlChanged) scheduleSave();
  });

  api.events.on("settings:changed", function (s) { if (s) settings = s; });

  // ---------- tab bar menu ----------

  api.ui.addTabMenuItem({
    id: "tree-tabs-new-group",
    icon: "🌲",
    label: "Move to New Group",
    title: "Put this tab in a new group in the Tree tab of the side panel",
    isVisible: function () { return ready; },
    onClick: function (t) {
      const node = tree.nodeForTab(t.tabId);
      if (node) wrapInGroup(node);
    },
  });

  // ---------- start ----------

  panelTab.onShow(scheduleRender);

  api.invoke("tree-tabs", "load-state").catch(function (err) {
    console.error("[Tree Tabs] Couldn't load the tree:", err);
    return null;
  }).then(function (state) {
    tree = restore(state, liveTabs());
    ready = true;
    const active = api.browser.getActiveTab();
    if (active) { activeTabId = active.tabId; reveal(active.tabId); }
    render();
    scheduleSave();
  });
})();
