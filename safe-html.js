"use strict";

// Cleans rich-text HTML before it is shown in one of the app's own windows
// (window.SafeHtml). Note text comes from places the app does not control: the
// clipboard, the note editor of the site open in a tab, old backup files and AI
// replies. The app's windows hold the bridge to the main process, so that HTML
// must never bring anything active with it. An <iframe> is the dangerous one (a
// frame inside the window can reach the bridge), and the rest is kept out on the
// same principle: only plain formatting gets through.
(function (root) {
  // Kept, with the attributes listed for each (plus GLOBAL_ATTRS).
  const ALLOWED = {
    a: ["href"],
    b: [], strong: [], i: [], em: [], u: [], s: [], strike: [], del: [], ins: [],
    mark: [], small: [], sub: [], sup: [], br: [], hr: [], wbr: [],
    p: [], div: [], span: [], blockquote: [], pre: [], code: [], kbd: [], samp: [],
    h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
    ul: ["type"], ol: ["start", "type", "reversed"], li: ["value"],
    dl: [], dt: [], dd: [],
    table: ["border", "cellpadding", "cellspacing", "width"],
    thead: [], tbody: [], tfoot: [], tr: [], caption: [],
    td: ["colspan", "rowspan", "width", "height", "valign"],
    th: ["colspan", "rowspan", "width", "height", "valign", "scope"],
    colgroup: ["span", "width"], col: ["span", "width"],
    img: ["src", "alt", "width", "height"],
    font: ["color", "face", "size"],
    center: [],
  };
  const GLOBAL_ATTRS = ["style", "title", "dir", "align"];

  // Removed together with everything inside them. Any other tag that is not in
  // ALLOWED is unwrapped: the tag goes, its text stays.
  const DROPPED = [
    "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet",
    "webview", "link", "meta", "base", "title", "head", "template", "noscript",
    "form", "input", "button", "select", "option", "textarea", "svg", "math",
    "video", "audio", "source", "track", "canvas", "portal", "fencedframe", "dialog",
  ];
  const DROPPED_SELECTOR = DROPPED.join(",");

  const LINK_SCHEMES = ["http:", "https:", "mailto:", "tel:"];
  const STYLE_PROPERTY =
    /^(color|background-color|font-(family|size|style|weight|variant[a-z-]*)|text-(align|indent|transform|decoration[a-z-]*)|line-height|letter-spacing|(margin|padding)-(top|right|bottom|left)|border-[a-z-]+|(min-|max-)?(width|height)|vertical-align|white-space[a-z-]*|list-style-type|word-break|overflow-wrap)$/;
  // Nothing that loads a file, and no negative offsets that pull text over the
  // rest of the window.
  const STYLE_VALUE_BLOCKED = /url\s*\(|image-set\s*\(|image\s*\(|expression\s*\(|var\s*\(|attr\s*\(|\\|(^|[\s,(])-\d/i;

  function safeLink(value) {
    const text = String(value || "").trim();
    if (text.startsWith("#")) return true;
    try {
      return LINK_SCHEMES.includes(new URL(text).protocol);
    } catch {
      return false;
    }
  }

  // Pictures: pasted ones are stored inside the note (data:), and ones copied
  // from a ticket point at the web. Never a file on this PC.
  function safeImageSource(value) {
    const text = String(value || "").trim();
    if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(text)) return true;
    if (/^blob:/i.test(text)) return true;
    try {
      const protocol = new URL(text).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }

  // Drops the properties that are not plain formatting and lets the browser
  // write the rest back, which keeps shorthands such as "border" short.
  function cleanStyle(el) {
    const style = el.style;
    const remove = [];
    for (let i = 0; i < style.length; i++) {
      const name = style[i];
      const value = style.getPropertyValue(name);
      if (!STYLE_PROPERTY.test(name) || !value || STYLE_VALUE_BLOCKED.test(value)) remove.push(name);
    }
    for (const name of remove) style.removeProperty(name);
    if (style.length === 0) el.removeAttribute("style");
  }

  function cleanAttributes(el, tag) {
    const allowed = ALLOWED[tag];
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!allowed.includes(name) && !GLOBAL_ATTRS.includes(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "href" && !safeLink(attr.value)) el.removeAttribute(attr.name);
      else if (name === "src" && !safeImageSource(attr.value)) el.removeAttribute(attr.name);
      else if (name === "style") cleanStyle(el);
    }
  }

  function cleanChildren(parent) {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === 3) continue; // text
      if (node.nodeType !== 1) { node.remove(); continue; } // comments and the rest
      const tag = node.localName;
      const isHtml = node.namespaceURI === "http://www.w3.org/1999/xhtml";
      if (!isHtml || DROPPED.includes(tag)) { node.remove(); continue; }
      cleanChildren(node);
      if (Object.prototype.hasOwnProperty.call(ALLOWED, tag)) {
        cleanAttributes(node, tag);
        // A picture whose address was refused would only show as a broken image.
        if (tag === "img" && !node.hasAttribute("src")) node.remove();
      } else {
        node.replaceWith(...Array.from(node.childNodes));
      }
    }
  }

  // Returns the HTML with only plain formatting left. The text is parsed in a
  // separate, inert document, so nothing in it loads or runs while it is cleaned.
  function sanitize(html) {
    const text = typeof html === "string" ? html : "";
    if (text === "") return "";
    const doc = new DOMParser().parseFromString("<!doctype html><body>" + text, "text/html");
    cleanChildren(doc.body);
    return doc.body.innerHTML;
  }

  // For an editor the person is typing in: takes active elements (frames, forms,
  // scripts...) out of the live content without touching anything else, so the
  // caret stays where it is. Used right after a paste or drop. Returns how many
  // were removed.
  function removeActiveContent(rootElement) {
    if (!rootElement || typeof rootElement.querySelectorAll !== "function") return 0;
    const found = rootElement.querySelectorAll(DROPPED_SELECTOR);
    found.forEach(function (el) { el.remove(); });
    return found.length;
  }

  const api = { sanitize, removeActiveContent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SafeHtml = api;
})(typeof window !== "undefined" ? window : globalThis);
