// Ticket preview hover card: hover a ticket in a side panel list (Ticket
// Search, Recent Tickets) and a small card shows its status, requester, agent
// and latest reply, read from the site's API through the site adapter's
// ticketPreview part. Plugins attach it with pluginAPI.ui.attachTicketPreview().
//
// One card is shared by every list. Previews are cached for a minute, so
// moving the mouse up and down a list doesn't call the API again.
//
// The pure helpers are exported for tests when loaded under Node.
(function (root) {
  "use strict";

  const SHOW_DELAY_MS = 450;   // hover this long before the card appears
  const HIDE_DELAY_MS = 120;   // so moving between rows doesn't flicker
  const CACHE_MS = 60 * 1000;
  const MAX_CACHE = 200;
  const CARD_WIDTH = 320;
  const GAP = 8;
  const MARGIN = 8;

  // ==================== Pure helpers ====================

  // "just now", "5 min ago", "3 h ago", "2 days ago", else a short date.
  function ago(iso, now) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 7 * 86400) { const d = Math.floor(s / 86400); return d + (d === 1 ? " day ago" : " days ago"); }
    return new Date(t).toLocaleDateString();
  }

  // Where the card goes: beside the row, on whichever side has room (left
  // first, since the side panel is usually on the right), its top level with
  // the row's and kept inside the window.
  function placeCard(anchor, card, viewport) {
    const w = card.width;
    const h = card.height;
    let left;
    if (anchor.left - GAP - w >= MARGIN) left = anchor.left - GAP - w;
    else if (anchor.right + GAP + w <= viewport.width - MARGIN) left = anchor.right + GAP;
    else left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - MARGIN - w));
    let top = anchor.top;
    if (top + h > viewport.height - MARGIN) top = viewport.height - MARGIN - h;
    top = Math.max(MARGIN, top);
    return { left: Math.round(left), top: Math.round(top) };
  }

  // The cache key for a ref: site + kind + number (or key, or link).
  function refKey(siteId, ref) {
    const r = ref || {};
    return [siteId || "", r.kind || "", String(r.id || r.key || r.url || "")].join("|");
  }

  // What the "Last reply" line calls the newest conversation.
  function replyHeading(lastReply, now) {
    if (!lastReply) return "";
    const what = lastReply.type === "note" ? "Private note" : lastReply.type === "requester" ? "Requester replied" : "Agent replied";
    const parts = [what];
    if (lastReply.from) parts[0] += lastReply.type === "note" ? " by " + lastReply.from : " (" + lastReply.from + ")";
    const when = ago(lastReply.at, now);
    if (when) parts.push(when);
    return parts.join(" · ");
  }

  // The label/value rows of the card, leaving out empty ones.
  function detailRows(p, now) {
    const rows = [];
    const state = [p.status, p.priority ? p.priority + " priority" : ""].filter(Boolean).join(" · ");
    if (state) rows.push(["Status", state]);
    if (p.requester || p.requesterEmail) {
      rows.push(["Requester", p.requester && p.requesterEmail && p.requester !== p.requesterEmail
        ? p.requester + " <" + p.requesterEmail + ">" : (p.requester || p.requesterEmail)]);
    }
    if (p.agent) rows.push(["Agent", p.agent]);
    const updated = ago(p.updatedAt, now);
    if (updated) rows.push(["Updated", updated]);
    return rows;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { ago, placeCard, refKey, replyHeading, detailRows, CARD_WIDTH };
    return;
  }

  // ===================== The card =====================

  // getSite(id) → the site adapter, or null. Called once by renderer.js.
  function create(getSite) {
    const cache = new Map(); // refKey → { at, promise }
    let card = null;
    let current = null;      // { el, key } the card is for (or will be)
    let showTimer = null;
    let hideTimer = null;
    let seq = 0;
    let parked = null;       // { el, title }: the row's own tooltip, put back on hide

    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }

    function ensureCard() {
      if (card) return card;
      card = el("div", "tp-card");
      card.setAttribute("role", "tooltip");
      card.hidden = true;
      document.body.appendChild(card);
      return card;
    }

    function load(site, ref) {
      const key = refKey(site.id, ref);
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
      const promise = Promise.resolve()
        .then(function () { return site.ticketPreview.preview(ref); })
        .catch(function (err) { return { error: (err && err.message) || String(err) }; })
        .then(function (res) {
          // Don't keep failures: the next hover tries again.
          if (!res || res.error) cache.delete(key);
          return res;
        });
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(key, { at: Date.now(), promise });
      return promise;
    }

    function render(site, ref, initial, res) {
      const c = ensureCard();
      const now = Date.now();
      const p = Object.assign({}, initial || {}, (res && res.preview) || {});
      c.textContent = "";

      const head = el("div", "tp-head");
      head.appendChild(el("span", "tp-num", (site.shortName ? site.shortName + " " : "") + (p.label || ref.label || ref.key || ref.id || "")));
      c.appendChild(head);
      if (p.subject || ref.title) c.appendChild(el("div", "tp-subject", p.subject || ref.title));

      const rows = detailRows(p, now);
      if (rows.length) {
        const dl = el("dl", "tp-rows");
        rows.forEach(function (r) {
          dl.appendChild(el("dt", null, r[0]));
          dl.appendChild(el("dd", null, r[1]));
        });
        c.appendChild(dl);
      }

      if (!res) {
        c.appendChild(el("div", "tp-muted tp-busy", "Loading the latest reply…"));
      } else if (res.error) {
        c.appendChild(el("div", "tp-muted tp-error", res.skipped && /Settings/.test(res.error) ? res.error : "Couldn't load the preview: " + res.error));
      } else if (p.lastReply) {
        const box = el("div", "tp-reply" + (p.lastReply.type === "note" ? " tp-reply-note" : ""));
        box.appendChild(el("div", "tp-reply-head", replyHeading(p.lastReply, now)));
        if (p.lastReply.snippet) box.appendChild(el("div", "tp-reply-text", p.lastReply.snippet));
        c.appendChild(box);
      } else {
        const box = el("div", "tp-reply");
        box.appendChild(el("div", "tp-reply-head", "No replies yet"));
        if (p.description) box.appendChild(el("div", "tp-reply-text", p.description));
        c.appendChild(box);
      }
    }

    function position(anchorEl) {
      if (!card || card.hidden) return;
      const a = anchorEl.getBoundingClientRect();
      const pos = placeCard(a, { width: card.offsetWidth || CARD_WIDTH, height: card.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight });
      card.style.left = pos.left + "px";
      card.style.top = pos.top + "px";
    }

    function hideNow() {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      seq++;
      current = null;
      if (card) card.hidden = true;
      if (parked) {
        if (!parked.el.hasAttribute("title")) parked.el.setAttribute("title", parked.title);
        parked = null;
      }
    }

    function show(anchorEl, site, ref, initial) {
      const mine = ++seq;
      // The row's own tooltip would cover the card; hide it while the card shows.
      if (parked && parked.el !== anchorEl) {
        if (!parked.el.hasAttribute("title")) parked.el.setAttribute("title", parked.title);
        parked = null;
      }
      if (!parked && anchorEl.hasAttribute("title")) {
        parked = { el: anchorEl, title: anchorEl.getAttribute("title") };
        anchorEl.removeAttribute("title");
      }
      render(site, ref, initial, null);
      card.hidden = false;
      position(anchorEl);
      load(site, ref).then(function (res) {
        if (mine !== seq || !anchorEl.isConnected) return;
        render(site, ref, initial, res);
        position(anchorEl);
      });
    }

    // opts: { ref: object | () => object, enabled?: () => boolean }
    // ref: { siteId, id?, key?, kind?, url?, label?, title?, initial? }, where
    // initial holds fields already known (from a search result) to show at once.
    function attach(anchorEl, opts) {
      if (!anchorEl || !opts) return function () {};
      function resolve() {
        if (typeof opts.enabled === "function" && !opts.enabled()) return null;
        const ref = typeof opts.ref === "function" ? opts.ref() : opts.ref;
        if (!ref || !ref.siteId) return null;
        const site = getSite(ref.siteId);
        if (!site || !site.ticketPreview) return null;
        if (typeof site.ticketPreview.supports === "function") {
          try { if (!site.ticketPreview.supports(ref)) return null; } catch { return null; }
        }
        return { site, ref };
      }
      function onEnter() {
        clearTimeout(hideTimer);
        const r = resolve();
        // A row with no preview closes the card left up by the row before.
        if (!r) { hideNow(); return; }
        const key = refKey(r.site.id, r.ref);
        if (current && current.el === anchorEl && current.key === key) return;
        clearTimeout(showTimer);
        const wasShowing = card && !card.hidden;
        current = { el: anchorEl, key };
        // Moving from one row to the next while the card is up switches at once.
        showTimer = setTimeout(function () {
          if (!current || current.el !== anchorEl) return;
          show(anchorEl, r.site, r.ref, r.ref.initial);
        }, wasShowing ? 60 : SHOW_DELAY_MS);
      }
      function onLeave() {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
          if (current && current.el === anchorEl) hideNow();
        }, HIDE_DELAY_MS);
      }
      function onPress() { hideNow(); }
      anchorEl.addEventListener("mouseenter", onEnter);
      anchorEl.addEventListener("mouseleave", onLeave);
      anchorEl.addEventListener("mousedown", onPress);
      anchorEl.addEventListener("keydown", onPress);
      return function detach() {
        anchorEl.removeEventListener("mouseenter", onEnter);
        anchorEl.removeEventListener("mouseleave", onLeave);
        anchorEl.removeEventListener("mousedown", onPress);
        anchorEl.removeEventListener("keydown", onPress);
        if (current && current.el === anchorEl) hideNow();
      };
    }

    // A list that scrolls or re-renders under the mouse leaves a stale card.
    document.addEventListener("scroll", function () { if (card && !card.hidden) hideNow(); }, true);
    window.addEventListener("blur", hideNow);
    setInterval(function () { if (current && !current.el.isConnected) hideNow(); }, 1000);

    return { attach, hide: hideNow, clearCache: function () { cache.clear(); } };
  }

  root.TicketPreview = { create, ago, placeCard, refKey, replyHeading, detailRows };
}(typeof window !== "undefined" ? window : this));
