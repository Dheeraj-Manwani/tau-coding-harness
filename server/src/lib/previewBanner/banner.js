/* Injected only by the development preview plugin; never part of a build. */
(function () {
  "use strict";

  if (window.self !== window.top || window.__TAU_PREVIEW_CAPTURE__ || window.__TAU_PREVIEW_BANNER_MOUNTED__) return;
  var config = window.__TAU_PREVIEW_BANNER__;
  if (!config || !config.publishUrl) return;
  var storageKey = "tau:preview-banner-dismissed:" + config.projectId;
  try {
    if (sessionStorage.getItem(storageKey) === "1") return;
  } catch (err) { /* Storage may be disabled. The banner still works. */ }
  window.__TAU_PREVIEW_BANNER_MOUNTED__ = true;

  function mount() {
    var host = document.createElement("tau-preview-banner");
    host.setAttribute("data-tau-overlay", "");
    host.style.cssText = "all:initial!important;display:block!important;position:fixed!important;top:0!important;left:0!important;right:0!important;width:100%!important;z-index:2147483647!important;";
    var shadow = host.attachShadow({ mode: "closed" });
    var style = document.createElement("style");
    style.textContent = ":host{color-scheme:light}*{box-sizing:border-box}.bar{display:flex;align-items:center;gap:16px;padding:12px 16px;background:#084b87;color:#fff;font:500 13px/1.5 system-ui,sans-serif}.message{flex:1;min-width:0}a{color:inherit;font-weight:700;text-decoration:underline;text-underline-offset:2px}button{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;color:#fff;font:24px/1 system-ui;cursor:pointer}button:hover{background:#ffffff20}a:focus-visible,button:focus-visible{outline:2px solid white;outline-offset:3px}@media(max-width:480px){.bar{padding:8px 12px;gap:8px;font-size:12px}}";
    var bar = document.createElement("aside");
    bar.className = "bar";
    bar.setAttribute("aria-label", "Development preview notice");
    var message = document.createElement("div");
    message.className = "message";
    message.appendChild(document.createTextNode("This is a temporary development preview. Preview links are not intended for public sharing. "));
    var link = document.createElement("a");
    link.textContent = "Publish your app";
    link.href = config.publishUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    message.appendChild(link);
    message.appendChild(document.createTextNode(" to share a live version."));
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "\u00d7";
    close.setAttribute("aria-label", "Dismiss development preview notice");
    bar.appendChild(message);
    bar.appendChild(close);
    shadow.appendChild(style);
    shadow.appendChild(bar);

    // Reserve space without replacing the app's existing body padding. Reapply
    // on responsive wrapping, and restore the exact inline value on dismissal.
    var body = document.body;
    var originalPadding = body.style.getPropertyValue("padding-top");
    var originalPriority = body.style.getPropertyPriority("padding-top");
    var basePadding = parseFloat(getComputedStyle(body).paddingTop) || 0;
    body.appendChild(host);
    function reserveSpace() {
      body.style.setProperty("padding-top", (basePadding + host.getBoundingClientRect().height) + "px", "important");
    }
    reserveSpace();
    var observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(reserveSpace) : null;
    if (observer) observer.observe(host);
    window.addEventListener("resize", reserveSpace);
    close.addEventListener("click", function () {
      try { sessionStorage.setItem(storageKey, "1"); } catch (err) { /* Optional persistence. */ }
      if (observer) observer.disconnect();
      window.removeEventListener("resize", reserveSpace);
      host.remove();
      if (originalPadding) body.style.setProperty("padding-top", originalPadding, originalPriority);
      else body.style.removeProperty("padding-top");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
