/* Early, dev-only bootstrap monitor. Reports status without exposing app data. */
(function () {
  "use strict";
  if (window.self === window.top) return;
  var state = "waiting";
  var transient = false;
  var loaded = document.readyState === "complete";
  function report() {
    window.parent.postMessage({ source: "tau-preview-health", state: state, transient: transient }, "*");
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
    if (target && target.tagName === "SCRIPT") fail(true);
    else if (event instanceof ErrorEvent) fail(false);
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    var message = String(event.reason && event.reason.message || event.reason || "");
    fail(/failed to fetch dynamically imported module|importing a module script failed|loading chunk .* failed/i.test(message));
  });
  window.addEventListener("load", function () { loaded = true; check(); });
  window.addEventListener("message", function (event) {
    if (event.source === window.parent && event.data && event.data.type === "tau:preview-probe") { check(); report(); }
  });
  var observer = new MutationObserver(check);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  report();
  check();
})();
