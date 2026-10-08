/* Early, dev-only bootstrap monitor.
 *
 * Runs first in the page, before any of the app's code, and tells the tau app
 * two things about a preview it is embedded in:
 *
 *   - its state — waiting, loaded or failed. Posted to any parent ("*"),
 *     because it says nothing about the app beyond that.
 *   - what went wrong: the first few errors, with their stacks. These name the
 *     app's source files and carry its own messages, so they are only ever
 *     posted with tau's own origin as the target. The browser delivers such a
 *     message to the parent only if the parent is that origin, so a page that
 *     merely embeds a preview gets the state and nothing else. Without a
 *     configured origin (`window.__TAU_PREVIEW_HEALTH__`, written in front of
 *     this script) they are not sent at all.
 *
 * The errors are what "Ask tau to fix" sends to the agent
 * (doc/PREVIEW_DIAGNOSTICS_PLAN.md §3.5). Plain ES5, like the badge.
 */
(function () {
  "use strict";
  if (window.self === window.top) return;
  var cfg = window.__TAU_PREVIEW_HEALTH__ || {};
  var PARENT = typeof cfg.parentOrigin === "string" ? cfg.parentOrigin : "";
  var MAX_ERRORS = 5;
  var state = "waiting";
  var transient = false;
  var loaded = document.readyState === "complete";
  var errors = [];
  function report() {
    window.parent.postMessage({ source: "tau-preview-health", state: state, transient: transient }, "*");
  }
  // Paths the agent's tools take: `/src/App.tsx:6:22`, not the sandbox URL
  // with the dev server's cache-busting query on it.
  function clean(value, max) {
    var s = String(value == null ? "" : value)
      .split(location.origin)
      .join("")
      .replace(/\?(?:t|v)=[\w.-]+/g, "");
    return s.length > max ? s.slice(0, max) + "…" : s;
  }
  function sendErrors() {
    if (!PARENT || !errors.length) return;
    try {
      window.parent.postMessage(
        { source: "tau-preview-health", type: "errors", path: location.pathname + location.search, errors: errors },
        PARENT
      );
    } catch (e) {
      /* a malformed origin, or the parent went away */
    }
  }
  function record(kind, message, stack, at) {
    var text = clean(message, 500);
    if (!text) return;
    for (var i = 0; i < errors.length; i++) {
      if (errors[i].kind === kind && errors[i].message === text) {
        errors[i].count++;
        sendErrors();
        return;
      }
    }
    if (errors.length >= MAX_ERRORS) return;
    var entry = { kind: kind, message: text, count: 1 };
    var trace = clean(stack, 2000);
    var where = clean(at, 300);
    if (trace) entry.stack = trace;
    if (where) entry.at = where;
    errors.push(entry);
    sendErrors();
  }
  function check() {
    if (document.querySelector("vite-error-overlay")) { fail(false); return; }
    if (state === "failed") return;
    var root = document.querySelector("#root, #app");
    if (loaded && root && (root.children.length || root.textContent.trim())) {
      state = "loaded";
      report();
      observer.disconnect();
    }
  }
  function fail(retryable) {
    if (state === "loaded" || (state === "failed" && (!transient || retryable))) return;
    state = "failed";
    transient = retryable;
    report();
  }
  window.addEventListener("error", function (event) {
    var target = event.target;
    // Network failure while fetching an entry/import is recoverable. Runtime
    // exceptions are app errors and should not trigger a reload loop.
    if (target && target.tagName === "SCRIPT") {
      record("script", "Failed to load " + (target.src || "a script"), "", "");
      fail(true);
    } else if (event instanceof ErrorEvent) {
      record(
        "error",
        event.message || (event.error && event.error.message),
        event.error && event.error.stack,
        event.filename ? event.filename + ":" + event.lineno + ":" + event.colno : ""
      );
      fail(false);
    }
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    var message = String(event.reason && event.reason.message || event.reason || "");
    record("rejection", message, event.reason && event.reason.stack, "");
    fail(/failed to fetch dynamically imported module|importing a module script failed|loading chunk .* failed/i.test(message));
  });
  window.addEventListener("load", function () { loaded = true; check(); });
  window.addEventListener("message", function (event) {
    if (event.source === window.parent && event.data && event.data.type === "tau:preview-probe") {
      check();
      report();
      sendErrors();
    }
  });
  var observer = new MutationObserver(check);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  report();
  check();
})();
