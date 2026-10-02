/**
 * The "Built with tau" badge — shown on free-plan previews and published sites.
 *
 * Runs inside apps tau did not write and cannot predict, so it is built to
 * neither break them nor be broken by them:
 *
 *   - Everything lives in a closed shadow root, so the app's CSS cannot restyle
 *     the badge and the badge's CSS cannot leak into the app.
 *   - The host element's own box is set inline with `!important`, which beats
 *     an author stylesheet's `!important` — a stray `tau-badge { display:none }`
 *     in the app's CSS does nothing.
 *   - Plain ES5-ish (var, no arrows, no template literals), like the visual-edit
 *     runtime, so it needs no transpilation and runs on anything.
 *
 * Configured by `window.__TAU_BADGE__` (preview: the worker prepends it) or by
 * the `data-*` attributes of its own <script> tag (published sites):
 *
 *   mode     "preview" | "site"   who is looking — the owner, or a visitor
 *   home     landing URL          "Build your own" target
 *   upgrade  billing URL          "Upgrade to Pro" target
 *   site     slug                 attribution on the landing link (site only)
 *
 * The text animation is a port of Magic UI's DiaTextReveal
 * (magicui.design/docs/components/dia-text-reveal): the same gradient, band
 * width and easing, driven by requestAnimationFrame instead of `motion`.
 * Reduced-motion is deliberately NOT honoured — the badge always animates.
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || window.__TAU_BADGE_MOUNTED__) return;
  window.__TAU_BADGE_MOUNTED__ = true;

  var script = document.currentScript;
  var data = (script && script.dataset) || {};
  var cfg = window.__TAU_BADGE__ || {};
  var MODE = cfg.mode || data.mode || "site";
  var HOME = cfg.home || data.home || "https://tauai.pro";
  var UPGRADE = cfg.upgrade || data.upgrade || HOME + "/pricing";
  var SITE = cfg.site || data.site || "";

  var TEXTS = ["Describe it, build it", "Built with tau"];

  // ── DiaTextReveal port ─────────────────────────────────────────────────────

  var COLORS = ["#c679c4", "#fa3d1d", "#ffb005", "#e1e1fe", "#0358f7"];
  var TEXT_COLOR = "#ffffff";
  var BAND_HALF = 17;
  var SWEEP_START = -BAND_HALF;
  var SWEEP_END = 100 + BAND_HALF;
  var SWEEP_MS = 1500;
  // How long each phrase rests once revealed, by TEXTS index: the tagline is
  // a lead-in, "Built with tau" is the message, so it stays up longer.
  var HOLD_MS = [2200, 6000];

  function sweepEase(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function buildGradient(pos) {
    var bandStart = pos - BAND_HALF;
    var bandEnd = pos + BAND_HALF;
    if (bandStart >= 100) {
      return "linear-gradient(90deg, " + TEXT_COLOR + ", " + TEXT_COLOR + ")";
    }
    var n = COLORS.length;
    var parts = [];
    if (bandStart > 0) {
      parts.push(TEXT_COLOR + " 0%", TEXT_COLOR + " " + bandStart.toFixed(2) + "%");
    }
    for (var i = 0; i < n; i++) {
      var pct = n === 1 ? pos : bandStart + (i / (n - 1)) * BAND_HALF * 2;
      parts.push(COLORS[i] + " " + pct.toFixed(2) + "%");
    }
    if (bandEnd < 100) {
      parts.push("transparent " + bandEnd.toFixed(2) + "%", "transparent 100%");
    }
    return "linear-gradient(90deg, " + parts.join(", ") + ")";
  }

  // ── Markup ─────────────────────────────────────────────────────────────────

  // The tau mark, traced from the app logo and centred in its 24×24 box.
  var MARK =
    '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="currentColor" d="M7.5 1.8H21.4C21.9 1.8 22.1 2.2 22 2.7C21.4 4.8 20.1 5.9 18 5.9H12.8L10.9 14.4C10.5 16.5 11 19.2 12.9 19.2C14.4 19.2 15.8 18.2 17.1 16.7C17.5 16.3 18.1 16.6 17.9 17.2C16.9 20.3 14.6 22.6 11.6 22.6C7.9 22.6 5.4 20 6.3 15.7L8.2 5.9C5.4 5.9 3.3 6.4 1.9 8C1.5 8.4 0.9 8.1 1.1 7.6C2.4 4.2 4.7 1.8 7.5 1.8Z"/>' +
    "</svg>";

  var CSS =
    ":host{all:initial}" +
    "*{box-sizing:border-box}" +
    ".root{font:500 12px/1 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
    "-webkit-font-smoothing:antialiased;color:#fff;letter-spacing:.01em}" +
    ".pill{all:unset;cursor:pointer;display:flex;align-items:center;gap:7px;height:32px;" +
    "padding:0 12px 0 10px;border-radius:999px;background:rgba(10,10,10,.92);" +
    "border:1px solid rgba(255,255,255,.12);" +
    "box-shadow:0 6px 24px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.06);" +
    "-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);" +
    "transition:transform .15s ease,border-color .15s ease}" +
    ".pill:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.3)}" +
    ".pill:focus-visible{outline:2px solid #fff;outline-offset:2px}" +
    ".mark{display:block;width:14px;height:14px;flex:none;color:#fff}" +
    ".text{display:inline-block;overflow:hidden;white-space:nowrap;color:transparent;" +
    "-webkit-background-clip:text;background-clip:text;background-size:100% 100%;" +
    "padding:2px 0;transition:width .4s cubic-bezier(.4,0,.2,1)}" +
    ".ghost{position:absolute;visibility:hidden;pointer-events:none;white-space:nowrap}" +
    // Card: popover above the pill (site), or a centred modal (preview, top level).
    ".card{position:absolute;right:0;bottom:42px;width:272px;padding:16px;border-radius:14px;" +
    "background:#0a0a0a;border:1px solid rgba(255,255,255,.12);" +
    "box-shadow:0 18px 48px rgba(0,0,0,.45);font-weight:400;line-height:1.5;" +
    "animation:in .16s ease-out}" +
    ".scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center;" +
    "padding:16px;animation:fade .16s ease-out}" +
    ".scrim .card{position:static;width:100%;max-width:340px}" +
    ".head{display:flex;align-items:center;gap:8px;margin-bottom:6px}" +
    ".head .mark{width:16px;height:16px}" +
    ".title{font-size:14px;font-weight:600;color:#fff}" +
    ".body{font-size:12.5px;color:#a3a3a3;margin:0 0 14px}" +
    ".cta{all:unset;cursor:pointer;display:block;text-align:center;padding:9px 12px;" +
    "border-radius:9px;background:#fff;color:#0a0a0a;font-size:13px;font-weight:600}" +
    ".cta:hover{background:#e5e5e5}" +
    ".cta:focus-visible,.link:focus-visible,.close:focus-visible{outline:2px solid #fff;outline-offset:2px}" +
    ".sep{height:1px;background:rgba(255,255,255,.1);margin:12px 0}" +
    ".link{all:unset;cursor:pointer;display:block;text-align:center;font-size:12px;color:#a3a3a3}" +
    ".link:hover{color:#fff}" +
    ".close{all:unset;cursor:pointer;display:block;width:100%;text-align:center;margin-top:10px;" +
    "font-size:12px;color:#737373}" +
    ".close:hover{color:#d4d4d4}" +
    "@keyframes in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}" +
    "@keyframes fade{from{opacity:0}to{opacity:1}}";

  function h(tag, cls, html) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  }

  var host = document.createElement("tau-badge");
  // The visual-edit runtime skips anything under [data-tau-overlay], so the
  // badge can never be picked as an element of the user's app.
  host.setAttribute("data-tau-overlay", "");
  var HOST_STYLE = {
    all: "initial",
    position: "fixed",
    right: "12px",
    bottom: "12px",
    "z-index": "2147483646",
    display: "block",
    visibility: "visible",
    opacity: "1",
    transform: "none",
    "pointer-events": "auto",
  };
  for (var prop in HOST_STYLE) host.style.setProperty(prop, HOST_STYLE[prop], "important");

  var shadow = host.attachShadow({ mode: "closed" });
  var style = document.createElement("style");
  style.textContent = CSS + "@media print{.root{display:none}}";
  shadow.appendChild(style);

  var root = h("div", "root");
  var pill = h("button", "pill");
  pill.type = "button";
  pill.setAttribute("aria-label", "Built with tau");
  pill.innerHTML = MARK;
  var text = h("span", "text");
  text.setAttribute("aria-hidden", "true");
  text.textContent = TEXTS[0];
  pill.appendChild(text);
  root.appendChild(pill);
  shadow.appendChild(root);

  // ── Loop ───────────────────────────────────────────────────────────────────

  var widths = [];
  var index = 0;

  function measure() {
    var ghost = h("span", "text ghost");
    root.appendChild(ghost);
    widths = TEXTS.map(function (t) {
      ghost.textContent = t;
      return Math.ceil(ghost.getBoundingClientRect().width);
    });
    root.removeChild(ghost);
  }

  function sweep(done) {
    var t0 = 0;
    function frame(now) {
      if (!t0) t0 = now;
      var t = Math.min((now - t0) / SWEEP_MS, 1);
      text.style.backgroundImage = buildGradient(
        SWEEP_START + (SWEEP_END - SWEEP_START) * sweepEase(t),
      );
      if (t < 1) requestAnimationFrame(frame);
      else done();
    }
    text.style.backgroundImage = buildGradient(SWEEP_START);
    requestAnimationFrame(frame);
  }

  function play() {
    if (removed) return;
    sweep(function () {
      setTimeout(function () {
        index = (index + 1) % TEXTS.length;
        text.textContent = TEXTS[index];
        if (widths[index]) text.style.width = widths[index] + "px";
        play();
      }, HOLD_MS[index]);
    });
  }

  // ── Click ──────────────────────────────────────────────────────────────────

  var open = null;

  function close() {
    if (!open) return;
    if (open.parentNode) open.parentNode.removeChild(open);
    open = null;
    pill.setAttribute("aria-expanded", "false");
  }

  function card(title, body, ctaLabel, ctaHref, extra) {
    var c = h("div", "card");
    c.setAttribute("role", "dialog");
    c.setAttribute("aria-label", title);
    var head = h("div", "head", MARK);
    head.appendChild(h("span", "title")).textContent = title;
    c.appendChild(head);
    c.appendChild(h("p", "body")).textContent = body;
    var cta = h("a", "cta");
    cta.href = ctaHref;
    cta.target = "_blank";
    cta.rel = "noopener";
    cta.textContent = ctaLabel;
    c.appendChild(cta);
    if (extra) extra(c);
    return c;
  }

  function upgradeCard() {
    return card(
      "Remove the tau badge",
      "Upgrade to Pro to remove this badge from your previews and published sites.",
      "Upgrade to Pro",
      UPGRADE,
      function (c) {
        var dismiss = h("button", "close");
        dismiss.type = "button";
        dismiss.textContent = "Not now";
        dismiss.addEventListener("click", close);
        c.appendChild(dismiss);
      },
    );
  }

  function visitorCard() {
    var href =
      HOME.replace(/\/+$/, "") +
      "/?ref=badge" +
      (SITE ? "&site=" + encodeURIComponent(SITE) : "");
    return card(
      "Built with tau",
      "Describe an app in plain words and tau builds it and puts it online.",
      "Build your own — free",
      href,
      function (c) {
        c.appendChild(h("div", "sep"));
        var own = h("a", "link");
        own.href = UPGRADE;
        own.target = "_blank";
        own.rel = "noopener";
        own.textContent = "Own this site? Remove this badge";
        c.appendChild(own);
      },
    );
  }

  pill.addEventListener("click", function (e) {
    e.stopPropagation();
    if (open) {
      close();
      return;
    }
    if (MODE === "preview") {
      // Inside the tau editor: let tau open its own upgrade modal, which goes
      // straight to checkout. The message carries nothing about the project.
      if (window.parent !== window) {
        try {
          window.parent.postMessage({ source: "tau-badge", type: "tau:upgrade" }, "*");
        } catch (err) {
          /* parent went away */
        }
        return;
      }
      var scrim = h("div", "scrim");
      scrim.appendChild(upgradeCard());
      scrim.addEventListener("click", function (ev) {
        if (ev.target === scrim) close();
      });
      open = scrim;
    } else {
      open = visitorCard();
    }
    root.appendChild(open);
    pill.setAttribute("aria-expanded", "true");
  });

  document.addEventListener("click", function (e) {
    // Clicks inside a closed shadow root are retargeted to the host.
    if (open && e.target !== host) close();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });

  // tau hides the badge live when the owner upgrades mid-session, instead of
  // waiting for the next preview reload.
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (e.source !== window.parent || !d || d.source !== "tau-parent") return;
    if (d.type === "tau:badge" && d.show === false) {
      unmount();
    }
  });

  // ── Mount ──────────────────────────────────────────────────────────────────

  var observer = null;
  var removed = false;

  function attach() {
    var parent = document.body || document.documentElement;
    if (!host.isConnected) parent.appendChild(host);
  }

  function unmount() {
    removed = true;
    if (observer) observer.disconnect();
    if (host.parentNode) host.parentNode.removeChild(host);
  }

  function start() {
    attach();
    measure();
    if (widths[0]) text.style.width = widths[0] + "px";
    // Some apps clear <body> on boot. Put the badge back if that happens.
    if (window.MutationObserver) {
      observer = new MutationObserver(function () {
        if (!removed && !host.isConnected) attach();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    play();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
