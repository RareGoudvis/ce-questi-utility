/* Questi Week Planner — content.js
 * Thin boot/relay layer. planner.js (loaded first, same isolated world) defines
 * window.__QWP_TOGGLE. This script:
 *   - guards against double injection (window.__QWP_BOOTED),
 *   - relays QWP_TOGGLE messages from background (toolbar action / Alt+P command),
 *   - provides an in-page Alt+P keydown fallback (works even if the command key
 *     is unregistered or intercepted by the SPA).
 * It injects nothing itself; the fullscreen page is built lazily by __QWP_TOGGLE. */
(function () {
  "use strict";
  if (window.__QWP_BOOTED) return;
  window.__QWP_BOOTED = true;

  function toggle() {
    if (typeof window.__QWP_TOGGLE === "function") {
      try { window.__QWP_TOGGLE(); } catch (e) { /* no-op */ }
    }
  }

  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === "QWP_TOGGLE") toggle();
    });
  } catch (e) { /* not in extension context */ }

  document.addEventListener(
    "keydown",
    function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    },
    true
  );

  // ----- Launcher button inside the Questi UI -----
  // Adds a "Weekplanner" button to Questi's top toolbar (next to the zoom/Week/print
  // icons). Falls back to a floating top-right button when the toolbar isn't found.
  // Runtime-discovered anchor + MutationObserver so it survives the SPA re-rendering.
  // Anchor = the calendar toolbar's print button (`.print-trigger` in `.calendar-header`),
  // so the launcher sits right after it — NOT in the top dark nav bar.
  function findToolbarAnchor() {
    var el = document.querySelector(".calendar-header .print-trigger") || document.querySelector("button.print-trigger");
    if (el && el.offsetParent !== null) return el;
    // Fallback: any visible control labelled print/afdrukken.
    var cands = document.querySelectorAll('button, a[role="button"], [role="button"]');
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i]; if (!c || c.offsetParent === null) continue;
      var label = ((c.getAttribute("aria-label") || "") + " " + (c.getAttribute("title") || "") + " " + (c.textContent || "")).toLowerCase();
      if (/\bprint\b|afdruk/.test(label)) return c;
    }
    return null;
  }
  // Styled to match Questi's light-gray toolbar chips (like the "Week" / "125%" chips):
  // rounded pill, dark text, a small calendar icon. Self-contained inline SVG + styles.
  function makeLauncher(floating) {
    var b = document.createElement("button");
    b.setAttribute("data-qwp-launcher", "1");
    b.type = "button";
    b.title = "Questi Weekplanner (Alt+P)";
    b.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg><span>Weekplanner</span>';
    b.style.cssText = "display:inline-flex;align-items:center;gap:7px;cursor:pointer;height:32px;padding:0 14px;margin:0 4px;border:none;border-radius:16px;background:#e4e7ea;color:#37474f;font:500 13px/1 Roboto,'Segoe UI',-apple-system,Arial,sans-serif;vertical-align:middle;white-space:nowrap;";
    if (floating) b.style.cssText += "position:fixed;top:56px;right:16px;z-index:2147482000;box-shadow:0 1px 4px rgba(0,0,0,.2);";
    b.addEventListener("mouseenter", function () { b.style.background = "#d6dade"; });
    b.addEventListener("mouseleave", function () { b.style.background = "#e4e7ea"; });
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggle(); });
    return b;
  }
  function ensureLauncher() {
    if (document.querySelector("[data-qwp-launcher]")) return; // idempotent
    var anchor = findToolbarAnchor();
    if (anchor && anchor.parentNode) { anchor.parentNode.insertBefore(makeLauncher(false), anchor.nextSibling); return; }
    if (document.body) document.body.appendChild(makeLauncher(true)); // fallback
  }
  var _luPending = false;
  function scheduleLauncher() {
    if (_luPending) return; _luPending = true;
    setTimeout(function () { _luPending = false; try { ensureLauncher(); } catch (e) {} }, 300);
  }
  try {
    scheduleLauncher();
    var mo = new MutationObserver(function () { if (!document.querySelector("[data-qwp-launcher]")) scheduleLauncher(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* no-op */ }
})();
