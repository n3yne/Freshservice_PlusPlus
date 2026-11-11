// Tree Style Tabs plugin — Settings window panel
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  settingsAPI.addPanel("tree-tabs", "Tree Style Tabs", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Tree Style Tabs</h3>' +
      '  <p class="settings-description settings-description-field">' +
      "    Open the <strong>🌲 Tree</strong> tab in the side panel to see your open tabs as a tree. Make named groups with " +
      "    <strong>＋ Group</strong>, and drag a tab or group onto another to put it underneath (drop on the middle of a row) " +
      "    or next to it (drop near its top or bottom edge). Any tab can have child tabs, and groups can hold groups, as deep as you like. " +
      "    Right-click a row for more, such as naming a tab, moving it up a level or closing a whole group. " +
      "    Closing a tab moves its children up a level. The tree is kept when you restart." +
      "  </p>" +
      '  <label class="settings-toggle">' +
      '    <input type="checkbox" id="plugin-tt-nest" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Put tabs opened from a link under the tab they came from</span>' +
      "  </label>" +
      '  <p class="settings-description">' +
      "    When a page opens a link in a new tab (or you choose <strong>Open Link in New Tab</strong>), the new tab goes under " +
      "    the page's tab. Turn this off to add every new tab at the top level." +
      "  </p>" +
      "</div>";

    const nest = panel.querySelector("#plugin-tt-nest");
    nest.addEventListener("change", function () {
      settingsAPI.saveSettings({ treeTabsNestOpened: nest.checked });
    });

    function populate(s) {
      nest.checked = !s || s.treeTabsNestOpened !== false;
    }
    populate(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(populate);
  });
})();
