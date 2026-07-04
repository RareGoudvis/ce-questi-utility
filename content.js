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
  // rounded pill, dark text, a small icon. Self-contained inline SVG + styles.
  var CAL_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
  var DOC_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>';
  function makeChip(opts, floating) {
    var b = document.createElement("button");
    b.setAttribute(opts.attr, "1");
    b.type = "button";
    b.title = opts.title;
    b.innerHTML = opts.icon + "<span>" + opts.label + "</span>";
    // Match Questi's own toolbar chips: urw-din font, slate ink (#304651), light-grey pill.
    b.style.cssText = "display:inline-flex;align-items:center;gap:7px;cursor:pointer;height:32px;padding:0 14px;margin:0 4px;border:none;border-radius:16px;background:#eceef0;color:#304651;font:600 13px/1 urw-din,q-urw-din,helvetica,'Segoe UI',Arial,sans-serif;vertical-align:middle;white-space:nowrap;";
    if (floating) b.style.cssText += "position:fixed;top:56px;right:" + (opts.floatRight || 16) + "px;z-index:2147482000;box-shadow:0 1px 4px rgba(0,0,0,.2);";
    b.addEventListener("mouseenter", function () { b.style.background = "#dfe2e5"; });
    b.addEventListener("mouseleave", function () { b.style.background = "#eceef0"; });
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); opts.onClick(); });
    return b;
  }
  var PLANNER_CHIP = { attr: "data-qwp-launcher", title: "Questi Weekplanner (Alt+P)", label: "Weekplanner", icon: CAL_ICON, floatRight: 16, onClick: toggle };
  var LESSONS_CHIP = { attr: "data-qwl-launcher", title: "Lesfiches beheren", label: "Lesfiches", icon: DOC_ICON, floatRight: 158, onClick: function () { if (typeof window.__QWP_OPEN_LESSONS === "function") window.__QWP_OPEN_LESSONS(); } };
  // The launcher belongs only on the calendar view. Questi is an SPA, so the URL can
  // change without a reload — gate on the current path and remove the button elsewhere.
  function onCalendar() { return /\/(calendar|kalender|agenda)/i.test(location.pathname || ""); }
  function haveChips() { return document.querySelector("[data-qwp-launcher]") && document.querySelector("[data-qwl-launcher]"); }
  function removeLauncher() {
    var a = document.querySelector("[data-qwp-launcher]"); if (a) a.remove();
    var b = document.querySelector("[data-qwl-launcher]"); if (b) b.remove();
  }
  function ensureLauncher() {
    if (!onCalendar()) { removeLauncher(); return; }   // off the calendar → no buttons
    if (haveChips()) return;                            // idempotent (both present)
    removeLauncher();                                   // clear a partial insert, re-add as a pair
    var anchor = findToolbarAnchor();
    if (anchor && anchor.parentNode) {
      // Insert Weekplanner right after the anchor, then Lesfiches right after that.
      var planner = makeChip(PLANNER_CHIP, false);
      anchor.parentNode.insertBefore(planner, anchor.nextSibling);
      anchor.parentNode.insertBefore(makeChip(LESSONS_CHIP, false), planner.nextSibling);
      return;
    }
    if (document.body) { document.body.appendChild(makeChip(PLANNER_CHIP, true)); document.body.appendChild(makeChip(LESSONS_CHIP, true)); } // fallback
  }
  var _luPending = false;
  function scheduleLauncher() {
    if (_luPending) return; _luPending = true;
    setTimeout(function () { _luPending = false; try { ensureLauncher(); } catch (e) {} }, 300);
  }
  try {
    scheduleLauncher();
    // Re-evaluate on any DOM change: adds the chips when the calendar renders, removes
    // them after an SPA navigation to a non-calendar page.
    var mo = new MutationObserver(function () {
      if (!onCalendar()) { removeLauncher(); return; }
      if (!haveChips()) scheduleLauncher();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    // Backstop: if the toolbar anchor is never found (SPA/DOM change), guarantee an entry
    // point by dropping the floating chips ~2.5s in. Common case: chips are already inline by
    // then, so haveChips() short-circuits this. Floating chips carry the same data-attrs, so no
    // duplicate insert. (Alt+P already rescues the planner; this is the only rescue for Lesfiches.)
    setTimeout(function () {
      try {
        if (onCalendar() && !haveChips() && document.body) {
          document.body.appendChild(makeChip(PLANNER_CHIP, true));
          document.body.appendChild(makeChip(LESSONS_CHIP, true));
        }
      } catch (e) { /* no-op */ }
    }, 2500);
  } catch (e) { /* no-op */ }
})();
