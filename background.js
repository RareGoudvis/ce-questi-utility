/* Questi Week Planner — background.js (MV3 service worker)
 * Relays the toolbar-action click and the Alt+P command to the active tab.
 * All UI/logic lives in the content scripts; this worker only forwards a toggle. */

function toggleActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "QWP_TOGGLE" }, function () {
      // Swallow "no receiving end" errors (e.g. non-questi tab) without noise.
      void chrome.runtime.lastError;
    });
  });
}

chrome.action.onClicked.addListener(function (tab) {
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "QWP_TOGGLE" }, function () {
    void chrome.runtime.lastError;
  });
});

chrome.commands.onCommand.addListener(function (command) {
  if (command === "toggle-planner") toggleActiveTab();
});

// Version check: the content script asks the worker to fetch the repo's version.json
// (cross-origin fetch is clean here — host is in host_permissions, no page CSP/CORS in play).
// Never throws back to the caller; on any failure it just returns { ok:false }.
var QWP_VERSION_URL = "https://raw.githubusercontent.com/RareGoudvis/ce-questi-utility/main/version.json";
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== "QWP_CHECK_VERSION") return; // not ours → let other listeners handle
  fetch(QWP_VERSION_URL, { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (j && j.version) sendResponse({ ok: true, latest: String(j.version), url: j.url || QWP_VERSION_URL });
      else sendResponse({ ok: false });
    })
    .catch(function () { sendResponse({ ok: false }); });
  return true; // keep the message channel open for the async sendResponse
});
