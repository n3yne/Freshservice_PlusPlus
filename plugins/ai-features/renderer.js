(function () {
  const api = window.pluginAPI;
  if (!api) return;

  const CW_NOTES_SCRAPE_SCRIPT = "(function() {" +
    "var parts = [];" +
    "document.querySelectorAll('.TicketNote-noteLabel').forEach(function(label) {" +
    "  var text = (label.innerText || label.textContent || '').trim();" +
    "  if (!text) return;" +
    "  var row = label.closest('.TicketNote-rowWrap') || label.closest('.TicketNote-row');" +
    "  var author = '';" +
    "  var date = '';" +
    "  if (row) {" +
    "    var authorEl = row.querySelector('.TicketNote-clickableName') || row.querySelector('.TicketNote-basicName');" +
    "    if (authorEl) author = (authorEl.innerText || '').trim();" +
    "    var dateEl = row.querySelector('.TimeText-date');" +
    "    if (dateEl) {" +
    "      date = Array.from(dateEl.childNodes)" +
    "        .filter(function(n) { return n.nodeType === 3; })" +
    "        .map(function(n) { return n.textContent.trim(); })" +
    "        .join(' ').trim();" +
    "    }" +
    "  }" +
    "  var header = [author, date].filter(Boolean).join(' — ');" +
    "  parts.push((header ? '[' + header + ']\\n' : '') + text);" +
    "});" +
    "return parts.join('\\n\\n---\\n\\n').substring(0, 15000);" +
    "})()";

  function markdownToHtml(text) {
    function inlineMarkdown(str) {
      return str
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>");
    }
    const lines = text.split("\n");
    const parts = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) { parts.push("<br>"); continue; }
      const header = trimmed.match(/^#{1,3}\s+(.+)/);
      if (header) { parts.push("<strong>" + inlineMarkdown(header[1]) + "</strong><br>"); continue; }
      const bullet = trimmed.match(/^[-*•]\s+(.*)/);
      if (bullet) { parts.push("&nbsp;&nbsp;• " + inlineMarkdown(bullet[1]) + "<br>"); continue; }
      parts.push(inlineMarkdown(trimmed) + "<br>");
    }
    return parts.join("").replace(/(<br>)+$/, "");
  }

  // --- Build #ai-buttons div ---
  const aiButtons = document.createElement("div");
  aiButtons.id = "ai-buttons";

  const btnSuggest = document.createElement("button");
  btnSuggest.type = "button";
  btnSuggest.id = "btn-ai-suggest";
  btnSuggest.className = "btn btn-small btn-ai";
  btnSuggest.title = "Get AI wording and clarity suggestions for these notes";
  btnSuggest.textContent = "✨ Suggest";

  const btnSummarize = document.createElement("button");
  btnSummarize.type = "button";
  btnSummarize.id = "btn-ai-summarize";
  btnSummarize.className = "btn btn-small btn-ai";
  btnSummarize.title = "Summarize all ticket notes from the current CW page";
  btnSummarize.textContent = "📋 Summarize";

  aiButtons.appendChild(btnSuggest);
  aiButtons.appendChild(btnSummarize);

  const cwSyncButtons = document.getElementById("cw-sync-buttons");
  if (cwSyncButtons && cwSyncButtons.parentNode) {
    cwSyncButtons.parentNode.insertBefore(aiButtons, cwSyncButtons.nextSibling);
  }

  // --- Build ai-overlay ---
  const aiOverlay = document.createElement("div");
  aiOverlay.id = "ai-overlay";
  aiOverlay.className = "ai-overlay";
  aiOverlay.innerHTML =
    '<div class="ai-dialog">' +
    '<div class="ai-dialog-header">' +
    '<h3 id="ai-dialog-title">AI Suggestion</h3>' +
    '<button type="button" id="btn-ai-close" class="settings-close" title="Close">&times;</button>' +
    "</div>" +
    '<div id="ai-dialog-body" class="ai-dialog-body"></div>' +
    '<div class="ai-dialog-footer">' +
    '<button type="button" id="btn-ai-apply" class="btn btn-primary">Apply</button>' +
    '<button type="button" id="btn-ai-copy" class="btn btn-secondary">📋 Copy</button>' +
    '<button type="button" id="btn-ai-cancel" class="btn btn-secondary">Cancel</button>' +
    "</div>" +
    "</div>";
  document.body.appendChild(aiOverlay);

  const aiDialogTitle = document.getElementById("ai-dialog-title");
  const aiDialogBody = document.getElementById("ai-dialog-body");
  const btnAiApply = document.getElementById("btn-ai-apply");
  const btnAiCopy = document.getElementById("btn-ai-copy");
  const btnAiCancel = document.getElementById("btn-ai-cancel");
  const btnAiClose = document.getElementById("btn-ai-close");

  let aiApplyCallback = null;

  function showAiOverlay(title, bodyHtml, applyCallback, applyLabel) {
    aiDialogTitle.textContent = title;
    aiDialogBody.innerHTML = bodyHtml;
    aiApplyCallback = applyCallback || null;
    btnAiApply.textContent = applyLabel || "Apply";
    btnAiApply.style.display = applyCallback ? "" : "none";
    aiOverlay.classList.add("visible");
  }

  function closeAiOverlay() {
    aiOverlay.classList.remove("visible");
    aiApplyCallback = null;
  }

  btnAiClose.addEventListener("click", closeAiOverlay);
  btnAiCancel.addEventListener("click", closeAiOverlay);
  aiOverlay.addEventListener("click", function (e) {
    if (e.target === aiOverlay) closeAiOverlay();
  });

  btnAiApply.addEventListener("click", async function () {
    if (aiApplyCallback) await aiApplyCallback();
    closeAiOverlay();
  });

  btnAiCopy.addEventListener("click", function () {
    const text = aiDialogBody.innerText;
    navigator.clipboard.writeText(text).catch(function () {});
  });

  // --- Suggest ---
  btnSuggest.addEventListener("click", async function () {
    const plainText = api.notes.getPlainText();
    if (!plainText || !plainText.trim()) {
      showAiOverlay("✨ AI Suggestion", '<p class="ai-error">Nothing to suggest — add some notes first.</p>', null);
      return;
    }

    const settings = api.getSettings();
    const sigHtml = settings.signatureHtml || "";
    let sigPlain = "";
    if (sigHtml) {
      const tmp = document.createElement("div");
      document.body.appendChild(tmp);
      tmp.innerHTML = sigHtml;
      sigPlain = tmp.innerText.trim();
      document.body.removeChild(tmp);
    }
    const trimmedFull = plainText.trimEnd();
    const textToSend = sigPlain && trimmedFull.endsWith(sigPlain)
      ? trimmedFull.slice(0, -sigPlain.length).trimEnd()
      : plainText;

    if (!textToSend.trim()) {
      showAiOverlay("✨ AI Suggestion", '<p class="ai-error">Nothing to suggest — add some notes first.</p>', null);
      return;
    }

    showAiOverlay("✨ AI Suggestion", '<div class="ai-loading">Thinking…</div>', null);

    let ticketContext = "";
    try {
      ticketContext = await api.browser.executeInActiveTab(CW_NOTES_SCRAPE_SCRIPT) || "";
    } catch { /* non-fatal — context is optional */ }

    let response;
    try {
      response = await api.invoke("ai-features", "suggest", {
        text: textToSend,
        ticketContext: ticketContext,
        settings: {
          aiProvider: settings.aiProvider,
          aiModelName: settings.aiModelName,
        },
      });
    } catch {
      aiDialogBody.innerHTML = '<p class="ai-error">Request failed — check your connection.</p>';
      return;
    }

    if (response.error) {
      aiDialogBody.innerHTML = '<p class="ai-error">' + response.error.replace(/</g, "&lt;") + "</p>";
      return;
    }
    if (!response.result) {
      aiDialogBody.innerHTML = '<p class="ai-error">AI returned an empty response.</p>';
      return;
    }

    let resultText = response.result;
    if (sigPlain) {
      const trimmedResult = resultText.trimEnd();
      if (trimmedResult.endsWith(sigPlain)) {
        resultText = trimmedResult.slice(0, -sigPlain.length).trimEnd();
      }
    }

    const escaped = resultText
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    aiDialogBody.innerHTML = '<div class="ai-result">' + escaped + "</div>";

    const capturedEscaped = escaped;
    const capturedSigHtml = sigHtml;
    const capturedResultText = resultText;
    aiApplyCallback = async function () {
      await api.notes.saveSnapshot(capturedResultText);
      const finalHtml = capturedSigHtml ? capturedEscaped + "<br>" + capturedSigHtml : capturedEscaped;
      api.notes.setContent(finalHtml);
    };
    btnAiApply.style.display = "";
  });

  // --- Summarize ---
  btnSummarize.addEventListener("click", async function () {
    showAiOverlay("📋 Ticket Summary", '<div class="ai-loading">Reading ticket notes…</div>', null);

    let pageText;
    try {
      pageText = await api.browser.executeInActiveTab(CW_NOTES_SCRAPE_SCRIPT);
    } catch {
      aiDialogBody.innerHTML = '<p class="ai-error">Could not read the ticket page.</p>';
      return;
    }

    if (!pageText || pageText.trim().length < 20) {
      aiDialogBody.innerHTML = '<p class="ai-error">No note content found on this page.</p>';
      return;
    }

    aiDialogBody.innerHTML = '<div class="ai-loading">Summarizing…</div>';

    const settings = api.getSettings();
    let response;
    try {
      response = await api.invoke("ai-features", "summarize", {
        text: pageText,
        settings: {
          aiProvider: settings.aiProvider,
          aiModelName: settings.aiModelName,
        },
      });
    } catch {
      aiDialogBody.innerHTML = '<p class="ai-error">Request failed — check your connection.</p>';
      return;
    }

    if (response.error) {
      aiDialogBody.innerHTML = '<p class="ai-error">' + response.error.replace(/</g, "&lt;") + "</p>";
      return;
    }
    if (!response.result) {
      aiDialogBody.innerHTML = '<p class="ai-error">AI returned an empty response.</p>';
      return;
    }

    const summaryHtml = markdownToHtml(response.result);
    aiDialogBody.innerHTML = '<div class="ai-result">' + summaryHtml + "</div>";

    const capturedSummaryResult = response.result;
    aiApplyCallback = async function () {
      const insertHtml = "<strong>AI Ticket Summary:</strong><br><br>" + markdownToHtml(capturedSummaryResult);
      await api.notes.saveSnapshot(capturedSummaryResult);
      const existing = api.notes.getContent().trim();
      api.notes.setContent(existing ? existing + "<br><br>" + insertHtml : insertHtml);
    };
    btnAiApply.textContent = "Insert";
    btnAiApply.style.display = "";
  });

}());
