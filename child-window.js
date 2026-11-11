// ===================================================
// MSP++ - Child window ("Open in New Window")
// ===================================================
// One page in a plain browser window: back, forward, reload, an address bar
// and the page. Opened by main.js createChildBrowserWindow with ?url=<page>.

document.addEventListener("DOMContentLoaded", function () {
  const container = document.getElementById("webview-container");
  const addressInput = document.getElementById("address-input");
  const addressBar = document.getElementById("address-bar");
  const btnBack = document.getElementById("btn-back");
  const btnForward = document.getElementById("btn-forward");
  const btnRefresh = document.getElementById("btn-refresh");
  const btnOpenTab = document.getElementById("btn-open-tab");
  const zoomBadge = document.getElementById("btn-zoom-reset");

  function isWebUrl(url) {
    try {
      const p = new URL(url);
      return p.protocol === "http:" || p.protocol === "https:";
    } catch { return false; }
  }

  // Theme follows the app setting.
  function applyTheme(settings) {
    document.body.setAttribute("data-theme", (settings && settings.theme) || "dark");
  }
  window.backupAPI.loadSettings().then(applyTheme).catch(function () { applyTheme(null); });
  window.backupAPI.onSettingsChanged(applyTheme);

  const startUrl = new URLSearchParams(window.location.search).get("url");
  let pendingAddress = null;

  const webview = document.createElement("webview");
  webview.setAttribute("src", isWebUrl(startUrl) ? startUrl : "about:blank");
  webview.setAttribute("allowpopups", "");
  webview.classList.add("active-webview");
  container.appendChild(webview);

  function currentUrl() {
    try { return webview.getURL(); } catch { return ""; }
  }

  function updateNavButtons() {
    try {
      btnBack.disabled = !webview.canGoBack();
      btnForward.disabled = !webview.canGoForward();
    } catch {
      btnBack.disabled = true;
      btnForward.disabled = true;
    }
  }

  function updateAddressBar(force) {
    if (!force && document.activeElement === addressInput) return;
    addressInput.value = window.AddressBar.displayAddress(pendingAddress || currentUrl());
    addressInput.classList.remove("invalid");
  }

  function updateZoomBadge() {
    let factor = 1;
    try { factor = webview.getZoomFactor(); } catch { /* not ready yet */ }
    zoomBadge.hidden = Math.abs(factor - 1) <= 0.001;
    zoomBadge.textContent = window.PageZoom.zoomPercent(factor);
  }

  function zoom(action) {
    try {
      webview.setZoomFactor(window.PageZoom.nextZoomFactor(webview.getZoomFactor(), action));
    } catch { /* not ready yet */ }
    updateZoomBadge();
  }

  function focusAddressBar() {
    try { webview.blur(); } catch { /* ignore */ }
    window.focus();
    addressInput.focus();
    addressInput.select();
  }

  function navigate() {
    const url = window.AddressBar.parseAddress(addressInput.value);
    if (!url) {
      addressInput.classList.add("invalid");
      addressInput.select();
      return;
    }
    addressInput.classList.remove("invalid");
    addressInput.value = url;
    pendingAddress = url;
    try {
      const loading = webview.loadURL(url);
      if (loading && typeof loading.catch === "function") {
        loading.catch(function (err) { console.warn("[Window] loadURL:", err && err.message); });
      }
    } catch (err) { console.warn("[Window] loadURL:", err && err.message); }
    webview.focus();
  }

  webview.addEventListener("did-navigate", function () {
    pendingAddress = null;
    updateNavButtons();
    updateAddressBar();
    updateZoomBadge();
  });
  webview.addEventListener("did-navigate-in-page", function (e) {
    updateNavButtons();
    if (e.isMainFrame !== false) updateAddressBar();
  });
  webview.addEventListener("did-stop-loading", function () {
    if (pendingAddress) { pendingAddress = null; updateAddressBar(); }
    updateNavButtons();
  });
  webview.addEventListener("page-title-updated", function (e) {
    if (e.title) document.title = e.title;
  });
  // The page called window.close(): close the window, as a browser would.
  webview.addEventListener("close", function () { window.close(); });
  window.backupAPI.onWebviewClose(function () { window.close(); });

  btnBack.addEventListener("click", function () { try { webview.goBack(); } catch { /* ignore */ } });
  btnForward.addEventListener("click", function () { try { webview.goForward(); } catch { /* ignore */ } });
  btnRefresh.addEventListener("click", function () { try { webview.reload(); } catch { /* ignore */ } });
  zoomBadge.addEventListener("click", function () { zoom("reset"); });

  btnOpenTab.addEventListener("click", function () {
    const url = currentUrl();
    if (!isWebUrl(url)) return;
    window.backupAPI.openInMainTab(url).then(function (res) {
      if (res && res.success) window.close();
    }).catch(function () { /* keep the window */ });
  });

  addressInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      navigate();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      updateAddressBar(true);
      webview.focus();
    }
  });
  addressInput.addEventListener("input", function () { addressInput.classList.remove("invalid"); });
  addressInput.addEventListener("blur", function () { updateAddressBar(); });

  // Clicking in the box selects the whole URL the first time, like a browser.
  let selectOnClick = false;
  addressInput.addEventListener("mousedown", function () {
    selectOnClick = document.activeElement !== addressInput;
  });
  addressInput.addEventListener("mouseup", function (e) {
    if (selectOnClick && addressInput.selectionStart === addressInput.selectionEnd) {
      e.preventDefault();
      addressInput.select();
    }
    selectOnClick = false;
  });
  // A focused webview keeps keyboard focus unless the window takes it back first.
  addressBar.addEventListener("mousedown", function (e) {
    if (e.target !== addressInput) return;
    if (document.activeElement === webview) {
      try { webview.blur(); } catch { /* ignore */ }
      window.focus();
    }
  });

  window.backupAPI.onFocusAddressBar(focusAddressBar);
  // Zoom keys and Ctrl+wheel over the page arrive from the main process.
  window.backupAPI.onPageZoom(function (data) {
    if (data && data.action) zoom(data.action);
  });

  // Shortcuts while the toolbar has focus. While the page has focus, the main
  // process handles them (this window has no menu bar).
  document.addEventListener("keydown", function (e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const zoomAction = window.PageZoom.zoomActionForKey(e);
    if (zoomAction) {
      e.preventDefault();
      zoom(zoomAction);
    } else if (key === "F5" || (ctrl && !e.altKey && (key === "r" || key === "R"))) {
      e.preventDefault();
      try {
        if (e.shiftKey || (key === "F5" && ctrl)) webview.reloadIgnoringCache();
        else webview.reload();
      } catch { /* ignore */ }
    } else if (e.altKey && key === "ArrowLeft" && document.activeElement !== addressInput) {
      e.preventDefault();
      try { webview.goBack(); } catch { /* ignore */ }
    } else if (e.altKey && key === "ArrowRight" && document.activeElement !== addressInput) {
      e.preventDefault();
      try { webview.goForward(); } catch { /* ignore */ }
    } else if (ctrl && !e.shiftKey && (key === "l" || key === "L")) {
      e.preventDefault();
      focusAddressBar();
    } else if (ctrl && !e.shiftKey && (key === "w" || key === "W")) {
      e.preventDefault();
      window.close();
    } else if (ctrl && !e.shiftKey && key === ",") {
      e.preventDefault();
      window.backupAPI.openSettingsWindow();
    }
  });

  updateAddressBar(true);
});
