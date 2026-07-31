/**
 * tau visual-edit runtime — runs INSIDE the generated app (the preview iframe).
 *
 * The preview is served from `https://5173-<sandboxId>.e2b.app`, a different
 * origin from the tau app. The parent page therefore cannot touch this DOM at
 * all — no contentDocument, no listeners. Everything hover/click related has to
 * live here and report out over postMessage. See doc/VISUAL_EDIT_PLAN.md §4.
 *
 * The highlight box is drawn here rather than by the parent on purpose: this
 * document knows its own scroll offset and transforms, so the outline tracks
 * correctly without a message per scroll frame.
 *
 * Injected by .tau/tagger.ts via transformIndexHtml, dev-server only. It is not
 * a file in the project, so it never reaches the manifest, GitHub, or the agent.
 *
 * WHY THIS IS .js AND NOT .ts — the only hand-written JS source in the repo.
 * It is never imported, bundled or compiled. The plugin reads it with
 * readFileSync and drops the bytes verbatim into a <script> tag, so whatever is
 * written here is exactly what the browser executes. TypeScript would need a
 * compile step to run *inside a generated user project*, which means shipping a
 * compiler into the plugin to save nothing. It is deliberately plain ES5-ish
 * (var, no arrow functions, no template literals) so it needs no transpilation
 * and cannot itself be the reason a preview fails to run.
 */
(function () {
  "use strict";

  // Replaced by the plugin at inject time. "*" means "not configured" — the
  // tau origin differs per deployment and the sandbox has no reliable way to be
  // told it (E2B `envs` don't always reach the start-cmd process; see
  // scripts/spike-e2b-envs.ts), so we discover it instead. See `lockedOrigin`.
  var PARENT_ORIGIN = "__TAU_PARENT_ORIGIN__";

  // The origin of the first parent that spoke to us, and the only one we ever
  // send to afterwards. Everything carrying a source path goes here, never to
  // "*": an attacker who embeds a user's preview in their own page must not be
  // able to read back the file layout of the project.
  var lockedOrigin = null;

  var ATTR = "data-tau-loc";
  var OUT = "tau-visual-edit"; // messages we send
  var IN = "tau-parent"; // messages we accept

  var enabled = false;
  var hovered = null;
  var selected = null;
  var box = null;
  var tag = null;

  /** Where replies go: the locked parent if we have one, else the configured
   *  origin, else "*" — and `send` refuses to broadcast anything sensitive. */
  function targetOrigin() {
    return lockedOrigin || PARENT_ORIGIN;
  }

  function send(msg) {
    var to = targetOrigin();
    // A message may only go to "*" if it carries nothing about the source tree.
    // `tau:ready` is the one such message, and it exists precisely so a parent
    // can announce itself and get locked in.
    if (to === "*" && msg.type !== "tau:ready") return;
    msg.source = OUT;
    try {
      window.parent.postMessage(msg, to);
    } catch (err) {
      /* parent went away */
    }
  }

  // ── Overlay ────────────────────────────────────────────────────────────────

  function ensureOverlay() {
    if (box) return;
    box = document.createElement("div");
    box.setAttribute("data-tau-overlay", "");
    box.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "pointer-events:none",
      "border:2px solid #7c6cff",
      "border-radius:3px",
      "background:rgba(124,108,255,0.10)",
      "transition:all 60ms linear",
      "display:none",
    ].join(";");

    tag = document.createElement("div");
    tag.style.cssText = [
      "position:absolute",
      "top:-21px",
      "left:-2px",
      "font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace",
      "background:#7c6cff",
      "color:#fff",
      "padding:0 6px",
      "border-radius:3px",
      "white-space:nowrap",
    ].join(";");

    box.appendChild(tag);
    document.body.appendChild(box);
  }

  function paint() {
    var el = selected || hovered;
    if (!enabled || !el || !el.isConnected) {
      if (box) box.style.display = "none";
      return;
    }
    ensureOverlay();
    var r = el.getBoundingClientRect();
    box.style.display = "block";
    box.style.top = r.top + "px";
    box.style.left = r.left + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    box.style.borderStyle = selected ? "solid" : "dashed";
    tag.textContent = el.tagName.toLowerCase();
  }

  // ── Element description ────────────────────────────────────────────────────

  function taggedAncestor(node) {
    if (!node) return null;
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !el.closest) return null;
    if (el.closest("[data-tau-overlay]")) return null; // never select our own UI
    return el.closest("[" + ATTR + "]");
  }

  /**
   * What the parent needs to render an inspector and decide which edits are safe.
   *
   * `editableText` is the important one: it is true only when the element's
   * content is a single static text node. Anything else — an expression, a
   * nested element, a mapped list — cannot be edited deterministically, and the
   * parent uses this to offer the chat fallback instead of a text box.
   */
  function describe(el) {
    var loc = el.getAttribute(ATTR);
    var text = "";
    var textNodes = 0;
    var elementNodes = 0;

    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) {
        if (n.nodeValue && n.nodeValue.trim()) {
          textNodes++;
          text = n.nodeValue;
        }
      } else if (n.nodeType === 1) {
        elementNodes++;
      }
    }

    // Several DOM nodes sharing one source position means they came out of a
    // .map(). Editing one edits all of them — the parent must warn.
    var siblingCount = document.querySelectorAll(
      "[" + ATTR + '="' + loc + '"]',
    ).length;

    var r = el.getBoundingClientRect();

    var out = {
      loc: loc,
      tagName: el.tagName.toLowerCase(),
      className: el.getAttribute("class") || "",
      text: text.trim(),
      editableText: textNodes === 1 && elementNodes === 0,
      siblingCount: siblingCount,
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
    };

    // Images carry their current source so the parent can show a thumbnail of
    // what is about to be replaced. `el.src` is the browser-resolved absolute
    // URL, which is what makes a preview work for `/hero.png` too — the parent
    // treats it as display-only and never sends it back as a new value.
    if (out.tagName === "img") {
      out.src = el.src || "";
      out.alt = el.getAttribute("alt") || "";
    }

    return out;
  }

  // ── Input handling ─────────────────────────────────────────────────────────

  function onMove(e) {
    if (!enabled) return;
    var el = taggedAncestor(e.target);
    if (el !== hovered) {
      hovered = el;
      paint();
      if (el) send({ type: "tau:hover", loc: el.getAttribute(ATTR) });
    }
  }

  // Capture-phase and swallowed, so selecting a <a> or a submit button doesn't
  // navigate the preview or fire the app's own handlers.
  function swallow(e) {
    if (!enabled) return;
    if (!taggedAncestor(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onClick(e) {
    if (!enabled) return;
    var el = taggedAncestor(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    selected = el;
    paint();
    send(Object.assign({ type: "tau:select" }, describe(el)));
  }

  function onKey(e) {
    if (!enabled) return;
    if (e.key === "Escape") {
      selected = null;
      paint();
      send({ type: "tau:deselect" });
    }
  }

  function onScroll() {
    if (enabled) paint();
  }

  function setEnabled(next) {
    if (enabled === next) return;
    enabled = next;
    if (!enabled) {
      hovered = null;
      selected = null;
    }
    document.documentElement.style.cursor = enabled ? "crosshair" : "";
    paint();
    send({ type: "tau:mode", enabled: enabled });
  }

  var CAPTURE = { capture: true };
  document.addEventListener("mousemove", onMove, CAPTURE);
  document.addEventListener("click", onClick, CAPTURE);
  document.addEventListener("mousedown", swallow, CAPTURE);
  document.addEventListener("mouseup", swallow, CAPTURE);
  document.addEventListener("keydown", onKey, CAPTURE);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);

  // ── Parent channel ─────────────────────────────────────────────────────────

  window.addEventListener("message", function (e) {
    // Anything can postMessage into this frame. Without this check a hostile
    // page could drive selection and read back source paths.
    if (PARENT_ORIGIN !== "*" && e.origin !== PARENT_ORIGIN) return;
    // Once configured, a second origin can never take over the channel.
    if (lockedOrigin && e.origin !== lockedOrigin) return;

    var d = e.data;
    if (!d || d.source !== IN) return;

    // First valid parent wins and owns the channel from here on.
    if (!lockedOrigin) lockedOrigin = e.origin;

    if (d.type === "tau:enable") setEnabled(true);
    else if (d.type === "tau:disable") setEnabled(false);
    else if (d.type === "tau:ping") {
      send({
        type: "tau:pong",
        tagged: document.querySelectorAll("[" + ATTR + "]").length,
      });
    } else if (d.type === "tau:reselect" && d.loc) {
      // After a hot reload the DOM node is replaced; re-attach by source
      // position so the selection survives the user's own edit.
      var el = document.querySelector("[" + ATTR + '="' + d.loc + '"]');
      if (el) {
        selected = el;
        paint();
      }
    }
  });

  function announce() {
    send({
      type: "tau:ready",
      tagged: document.querySelectorAll("[" + ATTR + "]").length,
    });
  }

  // Fires before React has mounted, so the parent treats `tagged` as a hint,
  // not a count. A second announce after paint gives it the real number.
  announce();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announce);
  }
  requestAnimationFrame(function () {
    requestAnimationFrame(announce);
  });
})();
