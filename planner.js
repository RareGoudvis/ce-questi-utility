/* Questi Week Planner (QWP) — planner.js
 * FULLSCREEN planning page for the Questi calendar.
 *
 * NO account-specific constants are baked in. schoolId, schoolyear, ownerId,
 * calendarId and groupId are all discovered at runtime by detectContext():
 *   - schoolId / schoolyear: scraped from the live Questi page (localStorage /
 *     sessionStorage / SPA globals / meta), then cross-checked/derived from the
 *     groups[].schoolId of the account's own agenda items.
 *   - calendarId / groupId: derived from the actually-loaded week items
 *     (id_calendar most common non-holiday calendar; groups[0]).
 *   - ownerId: from a tag with is_owner (or the owner.id of an own fiche).
 * If detection fails, the UI shows a clear error instead of silently loading 0.
 *
 * Layout requirements: fullscreen page; "2 weken" side by side and fitting the
 * viewport (no horizontal scroll); every cell clickable; top week nav; two
 * independent bottom filter panels; text-only buttons; WO + Godsdienst theme
 * rows spanning the whole week; pauze/speeltijd gap bands; Wednesday afternoon
 * marked no-school.
 *
 * Safety: single-occurrence writes (apply_to_next_items=false); mandatory
 * dry-run review; "Wegschrijven" locked until the diff is approved. Light only.
 */
(function () {
  "use strict";
  if (window.__QWP_PLANNER_LOADED) return;
  window.__QWP_PLANNER_LOADED = true;

  // ---------- Fixed (non-account) config ----------
  var API = "/api/cal";
  var ALL_FICHES_TAG = 8; // universal "Alle lesfiches" bucket (brief §3)

  // Runtime-detected context. Everything account/school/year-specific lives here.
  var ctx = { schoolId: null, schoolyear: null, calendarId: null, groupId: null, ownerId: null, ownDefaultTagId: null, ready: false };
  function myId() { return ctx.ownerId != null ? ctx.ownerId : "self"; }
  function writeGroups() { return [{ groupId: ctx.groupId, schoolId: ctx.schoolId }]; }

  // Vak taxonomy — NO hardcoded tag ids. `names` matches the live top-tag TITLE;
  // the numeric tag id is resolved at runtime into view.vakTagMap (buildVakTagMap).
  // `re` matches a fiche TITLE (slot-popup search). `thema` = WO/Godsdienst style.
  var VAKKEN = [
    { id: "wiskunde",        label: "Wiskunde",   thema: false, names: /wiskunde/i,     re: /\bblok\s*\d+|wisk|rekenen|meetkunde|getal|cijferen|maal|deel/i },
    { id: "taal",            label: "Taal",       thema: false, names: /^\s*taal\s*$/i,  re: /\bT\s*\d|taal|lezen|schrijven|spreken|luisteren|taalkanjer/i },
    { id: "spelling",        label: "Spelling",   thema: false, names: /spelling/i,     re: /\bTK\s*\d|spelling|dictee|controledictee/i },
    { id: "wereldorientatie", label: "WO",        thema: true,  names: /wereldori/i,    re: /wereldori|\bWO\b|thema/i },
    { id: "godsdienst",      label: "Godsdienst", thema: true,  names: /godsdienst/i,   re: /godsdienst/i },
    { id: "muvo",            label: "MUVO",       thema: false, names: /^\s*muvo\s*$|muzo/i, re: /muzo|muvo|beeld|dans|drama|muziek|media/i }
  ];
  function vakById(id) { for (var i = 0; i < VAKKEN.length; i++) if (VAKKEN[i].id === id) return VAKKEN[i]; return null; }
  // Live tag id for a vak (from the runtime title→id map).
  function vakTagId(vakId) { return view.vakTagMap[vakId] != null ? view.vakTagMap[vakId] : null; }
  // Build the vak→live-tag map by matching each VAKKEN.names to an own top tag.
  function buildVakTagMap() {
    var map = {}, tops = topTagsForOwner(ownTagsList(), ctx.ownerId);
    VAKKEN.forEach(function (v) {
      var hit = tops.filter(function (t) { return v.names.test((t.title || "").trim()); })[0];
      if (hit) map[v.id] = hit.id;
    });
    view.vakTagMap = map;
    console.log("[QWP] vak→tag map:", map);
  }
  // Instellingen used to store a VAKKEN string per slot ("taal"); it now stores a
  // live top-tag id. Convert any legacy values once the vak→tag map is built.
  function migrateSettingsToTagIds() {
    var changed = false;
    Object.keys(state.settings).forEach(function (k) {
      var v = state.settings[k];
      if (typeof v === "string" && vakById(v)) {
        var tid = vakTagId(v);
        if (tid != null) state.settings[k] = tid; else delete state.settings[k];
        changed = true;
      }
    });
    if (changed) saveState();
  }
  // Map a live top-tag id back to a VAKKEN vak id (Instellingen slot→vak). Unknown
  // tags (media, schrift, …) → null (no Instellingen preference).
  function vakIdForTag(tagId) { for (var i = 0; i < VAKKEN.length; i++) if (view.vakTagMap[VAKKEN[i].id] != null && String(view.vakTagMap[VAKKEN[i].id]) === String(tagId)) return VAKKEN[i].id; return null; }
  // Guess the live top-tag id for a slot title (e.g. "Cijferen tot 100" → wiskunde
  // tag) so the slot popup pre-selects the right vak with no manual pick.
  function guessVakTagFromTitle(title) {
    var t = title || ""; if (!t) return null;
    for (var i = 0; i < VAKKEN.length; i++) {
      var v = VAKKEN[i], tid = vakTagId(v.id);
      if (tid == null) continue;
      if (v.re.test(t) || v.names.test(t)) return tid;
    }
    return null;
  }

  // ---------- Storage ----------
  var STORE_KEY = "qwp_state_v6";
  function mkPanel(vak, sort) { return { source: "self", sortDir: sort || "az", filterVak: vak || null, filterTagId: null, hideUsed: false, gradeFilter: null }; }
  var state = { colleagues: [], settings: {}, weeks: 1, panelCount: 2, pickerView: "list", splitRatio: 0.58, manualSchoolId: null, manualSchoolyear: null, manualOwnTagId: null, panels: [mkPanel(null, "az"), mkPanel(null, "az"), mkPanel(null, "az")] };
  function loadState() {
    return new Promise(function (res) {
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([STORE_KEY], function (o) { if (o && o[STORE_KEY]) { try { mergeState(o[STORE_KEY]); } catch (e) {} } res(state); });
        } else {
          try { var s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); if (s) mergeState(s); } catch (e) {}
          res(state);
        }
      } catch (e) { res(state); }
    });
  }
  function mergeState(s) {
    if (s.colleagues) state.colleagues = s.colleagues;
    if (s.settings) state.settings = s.settings;
    if (s.weeks) state.weeks = s.weeks;
    if (s.manualSchoolId != null) state.manualSchoolId = s.manualSchoolId;
    if (s.manualSchoolyear != null) state.manualSchoolyear = s.manualSchoolyear;
    if (s.manualOwnTagId != null) state.manualOwnTagId = s.manualOwnTagId;
    if (s.panelCount) state.panelCount = s.panelCount;
    if (s.pickerView) state.pickerView = s.pickerView;
    if (s.splitRatio) state.splitRatio = s.splitRatio;
    if (Array.isArray(s.panels) && s.panels.length) {
      state.panels = [0, 1, 2].map(function (i) { return Object.assign(mkPanel(), state.panels[i], s.panels[i] || {}); });
    }
  }
  function saveState() {
    try {
      if (chrome && chrome.storage && chrome.storage.local) { var o = {}; o[STORE_KEY] = state; chrome.storage.local.set(o); }
      else localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  // ---------- Runtime context detection ----------
  function safeStorage(fn) { try { return fn(); } catch (e) { return null; } }
  function isNumericId(v) { if (v == null) return false; if (typeof v === "number") return v > 0 && v < 1e12; return /^\d{1,12}$/.test(String(v)); }
  function isYearLabel(v) { return typeof v === "string" && /20\d{2}\s*-\s*20\d{2}/.test(v); }
  function walkForKey(root, re, validate) {
    var stack = [root], seen = [], steps = 0;
    while (stack.length && steps < 40000) {
      steps++;
      var cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (seen.indexOf(cur) > -1) continue; if (seen.length < 5000) seen.push(cur);
      for (var k in cur) {
        var v; try { v = cur[k]; } catch (e) { continue; }
        if (re.test(k) && (!validate || validate(v))) return v;
        if (v && typeof v === "object") stack.push(v);
      }
    }
    return undefined;
  }
  function scrapeContext() {
    var out = { schoolId: null, schoolyear: null };
    var pools = [], rawTexts = [];
    ["__INITIAL_STATE__", "__NUXT__", "__NEXT_DATA__", "APP_CONFIG", "appConfig", "config", "questi", "Questi", "__APP__", "store", "__store"].forEach(function (g) { try { if (window[g]) pools.push(window[g]); } catch (e) {} });
    [safeStorage(function () { return localStorage; }), safeStorage(function () { return sessionStorage; })].forEach(function (st) {
      if (!st) return;
      try { for (var i = 0; i < st.length; i++) { var key = st.key(i); var raw = st.getItem(key); if (raw == null) continue; rawTexts.push(raw); pools.push({ __key: key, __val: raw }); try { pools.push(JSON.parse(raw)); } catch (e) {} } } catch (e) {}
    });
    var SID = /^(schoolid|school_id|id_school|idschool|activeschoolid|currentschoolid|selectedschoolid)$/i;
    var SYR = /^(schoolyear|school_year|activeschoolyear|current_schoolyear|selectedschoolyear|schooljaar|schoolyearlabel)$/i;
    for (var i = 0; i < pools.length && (out.schoolId == null || out.schoolyear == null); i++) {
      if (out.schoolId == null) { var sid = walkForKey(pools[i], SID, isNumericId); if (sid != null) out.schoolId = +sid; }
      if (out.schoolyear == null) { var syr = walkForKey(pools[i], SYR, isYearLabel); if (syr != null) out.schoolyear = String(syr); }
    }
    if (out.schoolyear == null) { for (var j = 0; j < rawTexts.length; j++) { var m = String(rawTexts[j]).match(/\b(20\d{2})\s*-\s*(20\d{2})\b/); if (m) { out.schoolyear = m[1] + " - " + m[2]; break; } } }
    if (out.schoolId == null) { var meta = document.querySelector('meta[name*="school" i]'); if (meta && isNumericId(meta.getAttribute("content"))) out.schoolId = +meta.getAttribute("content"); }
    return out;
  }
  function defaultSchoolyear() { var d = new Date(); var y = d.getFullYear(); var start = (d.getMonth() >= 7) ? y : y - 1; return start + " - " + (start + 1); }
  // /api/schools current_schoolyear can be an object — pull out a display string.
  function extractSchoolyear(v) {
    if (v == null) return null;
    if (typeof v === "string" || typeof v === "number") return String(v);
    if (typeof v === "object") {
      var cand = v.schoolyear || v.label || v.name || v.title || v.id;
      if (cand != null && typeof cand !== "object") return String(cand);
      if (v.startdate && v.enddate) { var a = String(v.startdate).slice(0, 4), b = String(v.enddate).slice(0, 4); if (a && b) return a + " - " + b; }
    }
    return null;
  }
  function detectOwnerFromTags(tags) { for (var i = 0; i < (tags || []).length; i++) { var t = tags[i]; if (t && t.is_owner) { var o = t.owner; var id = o && (typeof o === "object" ? o.id : o); if (id != null) return id; } } return null; }
  function tagOwnerId(t) { var o = t && t.owner; return o == null ? null : (typeof o === "object" ? o.id : o); }

  // Own default_tagId is PER USER (Questi rejects tag 8 on own fetches with
  // 1203). Resolve it universally, first hit wins:
  //   1) sniff Questi's own /lessons request (exact, no shape guessing)
  //   2) /api/cal/lessons/possible-settings (documented per-user default_tag)
  //   3) the user's own top-level "Alle lesfiches" tag from the tags list
  //   4) persisted manual override
  function sniffOwnLessonTag() {
    var urls = [];
    try { (performance.getEntriesByType("resource") || []).forEach(function (e) { if (e && e.name) urls.push(e.name); }); } catch (e) {}
    for (var i = 0; i < urls.length; i++) {
      var u = urls[i];
      if (u.indexOf("/cal/lessons") < 0) continue;
      if (/[?&]shared_userId=/.test(u)) continue; // colleague fetch — skip
      var m = u.match(/[?&]default_tagId=(\d+)/);
      if (m) return +m[1];
    }
    return null;
  }
  function pickTagId(obj) {
    if (obj == null) return null;
    var keys = ["default_tagId", "default_tag", "defaultTag", "defaultTagId", "tag", "tagId"];
    for (var i = 0; i < keys.length; i++) {
      if (obj[keys[i]] != null) { var v = obj[keys[i]]; return (typeof v === "object") ? (v.id != null ? v.id : null) : v; }
    }
    return null;
  }
  function bootPossibleSettings() {
    return jget(API + "/lessons/possible-settings?" + qs({ schoolId: ctx.schoolId })).then(function (j) {
      var r = (j && j.result) || j || {};
      return pickTagId(r) || pickTagId(r.settings) || null;
    }).catch(function () { return null; });
  }
  function resolveOwnDefaultTagFromTags(tags) {
    var owned = (tags || []).filter(function (t) { return t && String(tagOwnerId(t)) === String(ctx.ownerId); });
    var topLevel = owned.filter(function (t) { return t.parent == null || t.parent === 0; });
    var pool = topLevel.length ? topLevel : owned;
    // "Alle eigen lesfiches" (id 5, type default) — note the word between "alle" and "lesfiches".
    var byTitle = pool.filter(function (t) { return /alle.*lesfiches/i.test(t.title || ""); })[0];
    if (byTitle) return byTitle.id;
    var byDefault = pool.filter(function (t) { return t.type === "default"; })[0];
    if (byDefault) return byDefault.id;
    return pool.length ? pool[0].id : null;
  }
  function resolveOwnTag(tags) {
    var sniffed = sniffOwnLessonTag();
    if (sniffed != null) { ctx.ownDefaultTagId = sniffed; console.log("[QWP] own default tag →", sniffed, "(via sniff)"); return Promise.resolve(); }
    // Prefer the /lessons/tags?filter=own list — it cleanly carries the id-5 "Alle
    // eigen lesfiches" default tag. Fall back to possible-settings / unfiltered / manual.
    return fetchOwnTags().then(function (ownTags) {
      var fromOwn = resolveOwnDefaultTagFromTags(ownTags);
      if (fromOwn != null) { ctx.ownDefaultTagId = fromOwn; console.log("[QWP] own default tag →", fromOwn, "(via filter=own)"); return; }
      return bootPossibleSettings().then(function (ps) {
        if (ps != null) { ctx.ownDefaultTagId = ps; console.log("[QWP] own default tag →", ps, "(via possible-settings)"); return; }
        var fromTags = resolveOwnDefaultTagFromTags(tags);
        if (fromTags != null) { ctx.ownDefaultTagId = fromTags; console.log("[QWP] own default tag →", fromTags, "(via tags list)"); return; }
        if (state.manualOwnTagId != null) { ctx.ownDefaultTagId = state.manualOwnTagId; console.log("[QWP] own default tag →", state.manualOwnTagId, "(via manual)"); return; }
        console.error("[QWP] own default tag could NOT be resolved — fiches will not load. Set it manually.");
      });
    });
  }
  // First usable group id from a groups array — handles raw ids ([326]) OR objects
  // ([{groupId|id, schoolId}]); skips nulls. Live items use raw ids in detail.
  function firstGroupId(groups) {
    for (var i = 0; i < (groups || []).length; i++) {
      var g = groups[i];
      if (g == null) continue;
      var gid = (typeof g === "object") ? (g.groupId != null ? g.groupId : g.id) : g;
      if (gid != null) return gid;
    }
    return null;
  }
  function deriveFromItems(items) {
    var calCount = {}, best = null;
    (items || []).forEach(function (it) {
      var c = it.id_calendar;
      if (c && c !== "cal_holidays") calCount[c] = (calCount[c] || 0) + 1;
      if (it.groups && it.groups.length) {
        if (ctx.groupId == null) { var gid = firstGroupId(it.groups); if (gid != null) ctx.groupId = gid; }
        var g0 = it.groups[0];
        if (ctx.schoolId == null && g0 && typeof g0 === "object" && g0.schoolId != null) ctx.schoolId = g0.schoolId;
      }
    });
    Object.keys(calCount).forEach(function (c) { if (best == null || calCount[c] > calCount[best]) best = c; });
    if (best) ctx.calendarId = best;
  }
  function thisWeekRange() { var d = new Date(); var day = (d.getDay() + 6) % 7; var mon = new Date(d); mon.setDate(d.getDate() - day); var end = new Date(mon); end.setDate(mon.getDate() + 6); return { start: isoDate(mon), end: isoDate(end) }; }

  // Break the chicken-egg: Questi's own page already fired
  // /api/...?schoolId=NNNN&schoolyear=YYYY requests. Their URLs live in the
  // Performance resource timeline — read the real ids straight off them.
  // This needs no login-specific globals and no hardcoding.
  function sniffFromRequests() {
    var out = { schoolId: null, schoolyear: null, calendarId: null };
    var urls = [];
    try { (performance.getEntriesByType("resource") || []).forEach(function (e) { if (e && e.name) urls.push(e.name); }); } catch (e) {}
    try { urls.push(location.href); } catch (e) {}
    // Also sweep any anchor/script/link that carries the params.
    try { Array.prototype.forEach.call(document.querySelectorAll("[href],[src]"), function (n) { var u = n.getAttribute("href") || n.getAttribute("src"); if (u && u.indexOf("schoolId") > -1) urls.push(u); }); } catch (e) {}
    for (var i = 0; i < urls.length; i++) {
      var u = urls[i];
      if (out.schoolId == null) { var ms = u.match(/[?&]schoolId=(\d{1,12})/); if (ms) out.schoolId = +ms[1]; }
      if (out.schoolyear == null) { var my = u.match(/[?&]schoolyear=([^&#]+)/); if (my) { try { out.schoolyear = decodeURIComponent(my[1]); } catch (e) { out.schoolyear = my[1]; } } }
      if (out.calendarId == null) { var mc = u.match(/(cal_\d{2,})/); if (mc && mc[1] !== "cal_holidays") out.calendarId = mc[1]; }
      if (out.schoolId != null && out.schoolyear != null && out.calendarId != null) break;
    }
    return out;
  }
  function sniffCookies() {
    var out = { schoolId: null, schoolyear: null };
    try {
      String(document.cookie || "").split(";").forEach(function (kv) {
        var m = kv.split("="); var k = (m[0] || "").trim(); var v = decodeURIComponent((m[1] || "").trim());
        if (out.schoolId == null && /school.?id/i.test(k) && isNumericId(v)) out.schoolId = +v;
        if (out.schoolyear == null && /schoolyear|schooljaar/i.test(k) && isYearLabel(v)) out.schoolyear = v;
      });
    } catch (e) {}
    return out;
  }

  // Authoritative bootstrap (per live Questi app):
  //   GET /api/users/me   → result.id  = own user id (ownerId)
  //   GET /api/schools    → result[].id = schoolId, .current_schoolyear = year
  //   GET /api/cal/calendars?schoolId → calendar ids for the calendars[] filter
  var API_ROOT = "/api";
  function bootUsersMe() { return jget(API_ROOT + "/users/me").then(function (j) { var r = (j && j.result) || j; return r && (r.id != null ? r.id : null); }).catch(function () { return null; }); }
  function bootSchools() { return jget(API_ROOT + "/schools").then(function (j) { var r = (j && j.result) || []; return Array.isArray(r) ? r : []; }).catch(function () { return []; }); }
  function bootCalendars() { return jget(API + "/calendars?" + qs({ schoolId: ctx.schoolId })).then(function (j) { var r = (j && j.result) || []; return Array.isArray(r) ? r : []; }).catch(function () { return []; }); }
  function pickSchool(schools, preferId) {
    if (!schools.length) return null;
    if (preferId != null) { for (var i = 0; i < schools.length; i++) if (String(schools[i].id) === String(preferId)) return schools[i]; }
    return schools[0];
  }
  function calIdOf(c) { return c && (c.id != null ? c.id : (c.calendarId != null ? c.calendarId : c.id_calendar)); }

  function detectContext() {
    // Fallback hints (used only if the bootstrap calls come up empty).
    var net = sniffFromRequests(), scr = scrapeContext(), cook = sniffCookies();
    var hintSchoolId = net.schoolId != null ? net.schoolId : (scr.schoolId != null ? scr.schoolId : (cook.schoolId != null ? cook.schoolId : state.manualSchoolId));
    if (net.calendarId) ctx.calendarId = net.calendarId;

    return Promise.all([bootUsersMe(), bootSchools()]).then(function (r) {
      var me = r[0], schools = r[1];
      if (me != null) ctx.ownerId = me;
      var school = pickSchool(schools, hintSchoolId);
      if (school) { ctx.schoolId = school.id; var sy = extractSchoolyear(school.current_schoolyear); if (sy) ctx.schoolyear = sy; console.log("[QWP] current_schoolyear raw:", school.current_schoolyear, "→", sy); }
      else if (hintSchoolId != null) ctx.schoolId = hintSchoolId;
      if (!ctx.schoolyear) ctx.schoolyear = net.schoolyear || scr.schoolyear || cook.schoolyear || state.manualSchoolyear || defaultSchoolyear();
      console.log("[QWP] bootstrap → users/me id:", me, "| schools:", schools.length, "chosen schoolId:", ctx.schoolId, "schoolyear:", ctx.schoolyear);
      if (ctx.schoolId == null) { console.error("[QWP] schoolId null after /api/schools — use manual field."); return null; }
      return bootCalendars();
    }).then(function (cals) {
      if (!cals) return null;
      var ids = cals.map(calIdOf).filter(function (x) { return x && x !== "cal_holidays"; });
      console.log("[QWP] /cal/calendars →", ids);
      if (!ctx.calendarId && ids.length) ctx.calendarId = ids[0];
      var wr = thisWeekRange();
      var calList = (ids.length ? ids : (ctx.calendarId ? [ctx.calendarId] : [])).concat(["cal_holidays"]);
      return apiItems(wr.start, wr.end, calList.length ? calList : null);
    }).then(function (items) {
      if (items == null) return;
      deriveFromItems(items || []);
      console.log("[QWP] derived from " + ((items || []).length) + " agenda items →", { schoolId: ctx.schoolId, calendarId: ctx.calendarId, groupId: ctx.groupId });
      // List items carry empty groups; the real group id lives in item DETAIL. If not
      // yet known, fetch one editable item's detail to resolve it (writes need it).
      var groupProm = Promise.resolve();
      if (ctx.groupId == null) {
        var sample = (items || []).filter(function (x) { return x && x.id_calendar !== "cal_holidays" && x.is_editable !== false; })[0] || (items || [])[0];
        if (sample) groupProm = fetchItemDetail(sample.id).then(function (d) { if (d && d.groups && d.groups.length) { ctx.groupId = firstGroupId(d.groups); console.log("[QWP] groupId resolved from detail →", ctx.groupId); } }).catch(function () {});
      }
      return groupProm.then(function () {
        return fetchTags().then(function (tags) {
          if (ctx.ownerId == null) ctx.ownerId = detectOwnerFromTags(tags);
          return resolveOwnTag(tags);
        });
      });
    }).then(function () {
      ctx.ready = !!ctx.schoolId;
      console.log("[QWP] DETECTED CONTEXT:", { schoolId: ctx.schoolId, schoolyear: ctx.schoolyear, ownerId: ctx.ownerId, calendarId: ctx.calendarId, groupId: ctx.groupId });
      return ctx;
    }).catch(function (e) { console.error("[QWP] detectContext error:", e); return ctx; });
  }

  // ---------- API ----------
  function jget(url) { return fetch(url, { credentials: "include", headers: { "Accept": "application/json" } }).then(function (r) { return r.json(); }); }
  function qs(obj) {
    var p = [];
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (Array.isArray(v)) { v.forEach(function (x) { p.push(encodeURIComponent(k) + "[]=" + encodeURIComponent(x)); }); }
      else if (v !== undefined && v !== null) { p.push(encodeURIComponent(k) + "=" + encodeURIComponent(v)); }
    });
    return p.join("&");
  }

  function apiItems(startISO, endISO, calendars) {
    // No schoolyear param — the live app omits it for calendar reads, and a
    // non-primitive value (current_schoolyear can be an object) 500s the call.
    var q = { schoolId: ctx.schoolId, startdate: startISO, enddate: endISO };
    if (calendars && calendars.length) q.calendars = calendars;
    return jget(API + "/items?" + qs(q)).then(function (j) { return (j && j.result) || []; });
  }
  function fetchItems(startISO, endISO) { return apiItems(startISO, endISO, ctx.calendarId ? [ctx.calendarId, "cal_holidays"] : null); }
  function fetchItemDetail(id) { return jget(API + "/items/" + id + "?" + qs({ schoolId: ctx.schoolId })).then(function (j) { return (j && j.result) || j; }); }

  function isOwnSource(ownerId) { return ownerId == null || ownerId === "self" || (ctx.ownerId != null && String(ownerId) === String(ctx.ownerId)); }
  function lessonsGet(params) {
    var url = API + "/lessons?" + qs(params);
    return fetch(url, { credentials: "include", headers: { "Accept": "application/json" } }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, j: j, url: url }; }).catch(function () { return { status: r.status, j: null, url: url }; });
    }).catch(function (err) { return { status: 0, j: null, url: url, err: err }; });
  }
  function lessonsResult(res) {
    var j = res.j;
    var items = (j && (j.result || j.records || j.data || j.lessons)) || [];
    if (!Array.isArray(items)) items = [];
    var total = (j && (j.num_records != null ? j.num_records : (j.total != null ? j.total : j.count)));
    if (total == null) total = items.length;
    return { items: items, total: total };
  }
  function fetchFiches(ownerId, offset, num) {
    var own = isOwnSource(ownerId);
    var params = { schoolId: ctx.schoolId, sorting: "new_items", status: "active", num: num || 100, offset: offset || 0 };
    if (own) {
      // Own fetch requires the user's PERSONAL default tag (tag 8 is only valid
      // for shared_userId fetches → 1203). Never fire a guaranteed-400 call.
      if (ctx.ownDefaultTagId == null) { setStatus("Kon je eigen lesfiche-tag niet bepalen — vul die handmatig in via 'Vernieuwen' bij de context-fout."); console.error("[QWP] fetchFiches(own) aborted — ctx.ownDefaultTagId is null."); return Promise.resolve({ items: [], total: 0 }); }
      params.default_tagId = ctx.ownDefaultTagId;
    } else {
      // Prefer the colleague's own top tag; fall back to the universal bucket (8).
      params.shared_userId = ownerId; params.default_tagId = colleagueDefaultTag(ownerId);
    }
    return lessonsGet(params).then(function (res) {
      if (res.status < 400) { var r = lessonsResult(res); console.log("[QWP] /lessons ok:", res.url, "→", r.items.length, "of", r.total); return r; }
      console.error("[QWP] /lessons HTTP " + res.status + " URL:", res.url, "body:", JSON.stringify(res.j));
      return { items: [], total: 0 };
    }).catch(function (err) { console.error("[QWP] /lessons failed:", err); return { items: [], total: 0 }; });
  }
  function fetchAllFiches(ownerId) {
    return fetchFiches(ownerId, 0, 100).then(function (first) {
      var total = first.total, items = first.items.slice(), pages = Math.ceil(total / 100), chain = Promise.resolve();
      for (var p = 1; p < pages; p++) { (function (pg) { chain = chain.then(function () { return fetchFiches(ownerId, pg * 100, 100).then(function (r) { items = items.concat(r.items); }); }); })(p); }
      return chain.then(function () { return { items: items, total: total }; });
    });
  }
  // Server-side tag filtering: questi returns exactly the fiches under a tag.
  // A "default" bucket tag (Alle eigen lesfiches / zonder tag / samenwerk / universal)
  // uses default_tagId; a real category (type "user") uses user_tagId (per capture).
  function isDefaultBucketTag(ownerId, tagId) {
    var pool = tagPoolFor(ownerId);
    for (var i = 0; i < pool.length; i++) if (String(pool[i].id) === String(tagId)) return pool[i].type === "default";
    return String(tagId) === String(ALL_FICHES_TAG) || String(tagId) === String(ctx.ownDefaultTagId);
  }
  function fetchFichesByTag(ownerId, tagId, offset, num) {
    var own = isOwnSource(ownerId);
    var params = { schoolId: ctx.schoolId, sorting: "new_items", status: "active", num: num || 100, offset: offset || 0 };
    if (!own) params.shared_userId = ownerId;
    if (isDefaultBucketTag(ownerId, tagId)) params.default_tagId = tagId; else params.user_tagId = tagId;
    return lessonsGet(params).then(function (res) {
      if (res.status < 400) return lessonsResult(res);
      console.error("[QWP] /lessons(tag " + tagId + ") HTTP " + res.status + " URL:", res.url, "body:", JSON.stringify(res.j));
      return { items: [], total: 0 };
    }).catch(function (err) { console.error("[QWP] /lessons(tag) failed:", err); return { items: [], total: 0 }; });
  }
  function fetchAllFichesByTag(ownerId, tagId) {
    return fetchFichesByTag(ownerId, tagId, 0, 100).then(function (first) {
      var total = first.total, items = first.items.slice(), pages = Math.ceil(total / 100), chain = Promise.resolve();
      for (var p = 1; p < pages; p++) { (function (pg) { chain = chain.then(function () { return fetchFichesByTag(ownerId, tagId, pg * 100, 100).then(function (r) { items = items.concat(r.items); }); }); })(p); }
      return chain.then(function () { return { items: items, total: total }; });
    });
  }
  function cacheKey(ownerId, tagId) { return String(ownerId) + "|" + String(tagId); }
  function unionKey(ownerId, parentTagId) { return "union|" + String(ownerId) + "|" + String(parentTagId); }
  // Ensure fiches for (owner, tag) are cached; returns a promise of the item array.
  function ensureFiches(ownerId, tagId) {
    if (tagId == null) return Promise.resolve([]);
    var k = cacheKey(ownerId, tagId);
    if (view.ficheCache[k]) return Promise.resolve(view.ficheCache[k]);
    return fetchAllFichesByTag(ownerId, tagId).then(function (r) { view.ficheCache[k] = r.items; return r.items; });
  }
  // "Alle" = the union of the parent tag + all its child tags (server filters by a
  // single tag at a time, so a parent fetch alone misses fiches tagged only under
  // a child). Fetch each and merge/dedupe by fiche id.
  function ensureFichesUnion(ownerId, parentTagId, childIds) {
    if (parentTagId == null) return Promise.resolve([]);
    var k = unionKey(ownerId, parentTagId);
    if (view.ficheCache[k]) return Promise.resolve(view.ficheCache[k]);
    var ids = [parentTagId].concat(childIds || []);
    return Promise.all(ids.map(function (id) { return ensureFiches(ownerId, id); })).then(function (lists) {
      var seen = {}, merged = [];
      lists.forEach(function (arr) { (arr || []).forEach(function (f) { if (f && !seen[f.id]) { seen[f.id] = true; merged.push(f); } }); });
      view.ficheCache[k] = merged; return merged;
    });
  }
  // Which cache key a panel currently reads: the union when in "Alle" mode, else
  // the single selected tag.
  function panelCacheKey(p) { return p.unionMode ? unionKey(p.source, p.filterVak) : cacheKey(p.source, p.filterTagId); }

  var _tagsCache = null, _ownTagsCache = null, _sharedTagsCache = null;
  function fetchTags() { if (_tagsCache) return Promise.resolve(_tagsCache); return jget(API + "/lessons/tags?" + qs({ schoolId: ctx.schoolId })).then(function (j) { _tagsCache = (j && j.result) || []; return _tagsCache; }); }
  // filter=own → the user's own tag hierarchy (small, clean); filter=shared → colleagues' tags.
  function fetchOwnTags() { if (_ownTagsCache) return Promise.resolve(_ownTagsCache); return jget(API + "/lessons/tags?" + qs({ schoolId: ctx.schoolId, filter: "own" })).then(function (j) { _ownTagsCache = (j && j.result) || []; return _ownTagsCache; }).catch(function () { return []; }); }
  function fetchSharedTags() { if (_sharedTagsCache) return Promise.resolve(_sharedTagsCache); return jget(API + "/lessons/tags?" + qs({ schoolId: ctx.schoolId, filter: "shared", active_users: true })).then(function (j) { _sharedTagsCache = (j && j.result) || []; return _sharedTagsCache; }).catch(function () { return []; }); }
  var SYSTEM_TAG_IDS = { 1: true, 2: true }; // "zonder tag" + "samenwerk" — hide from vak pills (keep 5 = Alle).
  function isTopLevel(t) { return t && (t.parent == null || t.parent === 0); }
  // Top-level vak pills for a given owner: the "Alle" bucket (id 5) first, then subject roots, A→Z.
  function topTagsForOwner(tags, ownerId) {
    var mine = (tags || []).filter(function (t) { return isTopLevel(t) && String(tagOwnerId(t)) === String(ownerId); });
    var alle = mine.filter(function (t) { return t.type === "default" && /alle.*lesfiches/i.test(t.title || ""); });
    var subjects = mine.filter(function (t) { return !SYSTEM_TAG_IDS[t.id] && !(t.type === "default" && /alle.*lesfiches/i.test(t.title || "")); })
      .sort(function (a, b) { return (a.title || "").trim().localeCompare((b.title || "").trim(), undefined, { numeric: true }); });
    return alle.concat(subjects);
  }
  function fetchPeople() { return jget(API + "/items/shares/possible-participants?" + qs({ schoolId: ctx.schoolId })).then(function (j) { return ((j && j.result) || []).map(function (p) { return { id: p.id, name: ((p.firstname || "") + " " + (p.lastname || "")).trim() }; }); }).catch(function () { return []; }); }

  // Resolve a JSON response and throw the server's error_msg on any failure, so the
  // real code (e.g. "1234 - …") reaches the UI instead of a silent/opaque abort.
  function resolveWrite(kind, id, r, sent) {
    return r.json().catch(function () { return null; }).then(function (j) {
      if (r.ok && !(j && j.status === "error")) return j;
      var msg = (j && (j.error_msg || j.message)) || ("HTTP " + r.status);
      console.error("[QWP] " + kind + " " + id + " failed:", msg, "| body:", JSON.stringify(j), "| sent:", JSON.stringify(sent));
      throw new Error(msg);
    });
  }
  // Recurring lesuren need the occurrence window (range_startdate/enddate) so the edit
  // hits ONLY this week's occurrence, never the whole series (apply_to_next_items=false).
  function patchItem(id, body, range) {
    var q = { schoolId: ctx.schoolId, schoolyear: ctx.schoolyear, apply_to_next_items: false };
    if (range && range.start && range.end) { q.range_startdate = range.start; q.range_enddate = range.end; }
    return fetch(API + "/items/" + id + "?" + qs(q),
      { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return resolveWrite("PATCH item", id, r, body); });
  }
  // PATCH item.groups are OBJECTS [{groupId,schoolId}]; the attachment POST wants RAW ids
  // ([326]). Both tolerate a read shape that uses `id` instead of `groupId`.
  function writeGroupObjs(groups) {
    var out = ((groups && groups.length) ? groups : []).map(function (g) {
      if (g == null) return null;
      if (typeof g !== "object") return { groupId: g, schoolId: ctx.schoolId };
      var gid = (g.groupId != null ? g.groupId : g.id);
      return gid == null ? null : { groupId: gid, schoolId: (g.schoolId != null ? g.schoolId : ctx.schoolId) };
    }).filter(Boolean);
    // Fall back to the detected class group; NEVER emit {groupId:null} (SQL rejects it).
    if (!out.length && ctx.groupId != null) out = [{ groupId: ctx.groupId, schoolId: ctx.schoolId }];
    return out;
  }
  function groupIds(groups) {
    return (groups && groups.length ? groups : writeGroups()).map(function (g) { return (g && typeof g === "object") ? (g.groupId != null ? g.groupId : g.id) : g; }).filter(function (x) { return x != null; });
  }
  function postAttachment(id, lessonContentId, groups) {
    var payload = { attachments: [{ schoolId: ctx.schoolId, visible_parents: false, visible_students: false, students: [], groups: groupIds(groups), id: lessonContentId, typeId: 1 }] };
    return fetch(API + "/items/" + id + "/attachments?" + qs({ schoolId: ctx.schoolId, schoolyear: ctx.schoolyear }),
      { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(payload) }).then(function (r) { return resolveWrite("POST attachment", id, r, payload); });
  }

  // ---------- Domain helpers ----------
  var GYM_RE = /\b(LO|zwemmen|gym|turnen|L\.O\.)\b/i;
  var THEMA_RE = /\b(WO|wereldori|godsdienst)\b/i;
  var WO_RE = /\bWO\b|wereldori/i;
  var GD_RE = /godsdienst/i;
  function isGymTitle(t) { return GYM_RE.test(t || ""); }
  function isThemaTitle(t) { return THEMA_RE.test(t || ""); }
  // Commit rule (for the external reader): item title = fiche title (set on assign /
  // by the attachment POST); item description = the top-level vak (subject) name.
  function descFor(slot) {
    if (slot.isGym) return null;
    if (slot.themaFiche) return "Zie themafiche.";
    var top = topTagIdOf(slot.vak || guessVakTagFromTitle(slot.title));
    return top != null ? ((tagTitle("self", top) || "").trim()) : "";
  }
  function toHtmlDesc(t) { if (t == null) return ""; return String(t).replace(/\n/g, "<br />"); }
  function stripHtml(s) { return String(s == null ? "" : s).replace(/<br \/>/g, "").replace(/<[^>]*>/g, "").trim(); }
  function weekdayIdx(iso) { if (!iso) return -1; var d = new Date(iso); if (isNaN(d.getTime())) return -1; return (d.getDay() + 6) % 7; }
  function timeFromISO(iso) { if (!iso) return ""; var m = String(iso).match(/[T ](\d{2}:\d{2})/); return m ? m[1] : ""; }
  function isoDate(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(iso, n) { var d = new Date(String(iso) + "T00:00:00"); if (isNaN(d.getTime())) return null; d.setDate(d.getDate() + n); return d; }
  function ddmm(iso, offset) { var d = addDays(iso, offset || 0); return d ? String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") : ""; }
  function slotKeyStd(dayIdx, time) { return dayIdx + "|" + time; }

  function computeDirty(s) {
    var descChanged = toHtmlDesc(descFor(s)) !== (s.origDescription || "");
    var titleChanged = (s.title || "") !== (s.origTitle || "");
    var ficheChanged = (s.ficheContentId || null) !== (s.origFicheContentId || null);
    return descChanged || titleChanged || ficheChanged;
  }

  function ficheTagIds(f) {
    var raw = f.tags || f.tagIds || f.tag_ids || f.categories || [];
    if (!Array.isArray(raw)) return [];
    return raw.map(function (t) { return typeof t === "object" ? (t.id != null ? t.id : t.tagId) : t; }).filter(function (x) { return x != null; });
  }
  var _anyTagsMemo = null;
  function datasetHasFicheTags() {
    if (_anyTagsMemo != null) return _anyTagsMemo;
    _anyTagsMemo = view.ficheGroups.some(function (g) { return g.items.some(function (f) { return ficheTagIds(f).length; }); });
    return _anyTagsMemo;
  }
  function resolveOwner(ownerId) { return (ownerId === "self" || ownerId == null) ? ctx.ownerId : ownerId; }
  function vakTagIds(vak) {
    if (!vak) return {};
    var root = vakTagId(vak.id); if (root == null) return {};
    var byParent = {};
    view.tags.forEach(function (t) { (byParent[t.parent] = byParent[t.parent] || []).push(t); });
    var set = {}; set[root] = true;
    var stack = [root];
    while (stack.length) { var cur = stack.pop(); (byParent[cur] || []).forEach(function (t) { if (!set[t.id]) { set[t.id] = true; stack.push(t.id); } }); }
    return set;
  }
  function ficheInVak(f, vak) {
    if (!vak) return true;
    if (datasetHasFicheTags()) {
      var set = vakTagIds(vak); var ids = ficheTagIds(f);
      for (var i = 0; i < ids.length; i++) { if (set[ids[i]]) return true; }
      return false;
    }
    return vak.re.test(f.subject || "");
  }
  function subcatsForVak(ownerId, vak) {
    if (!vak || !datasetHasFicheTags()) return [];
    var set = vakTagIds(vak); var owner = resolveOwner(ownerId); var root = vakTagId(vak.id);
    return view.tags.filter(function (t) {
      if (t.id === root) return false;
      if (!set[t.id]) return false;
      var o = t.owner && (typeof t.owner === "object" ? t.owner.id : t.owner);
      return (t.type === "user" || t.type === "default") && (o === owner || o == null);
    }).sort(function (a, b) { return (a.title || "").localeCompare(b.title || ""); });
  }
  // Current school-year window: Sep 1 (start year) → Aug 31 (start year + 1).
  function schoolYearBounds() {
    var sy = String(ctx.schoolyear || ""), m = sy.match(/(20\d{2})\s*-\s*(20\d{2})/), startY;
    if (m) startY = +m[1];
    else { var d = new Date(); startY = (d.getMonth() >= 7) ? d.getFullYear() : d.getFullYear() - 1; }
    return { start: new Date(startY, 8, 1), end: new Date(startY + 1, 7, 31, 23, 59, 59) };
  }
  // "Gebruikt" only counts when the fiche was last used within THIS school year.
  function usedThisYear(f) {
    var d = f && f.last_used_date; if (!d) return false;
    var s = String(d); if (s.length <= 4 || s.indexOf("0000") === 0) return false;
    var dt = new Date(s.replace(" ", "T")); if (isNaN(dt.getTime())) return false;
    var b = schoolYearBounds();
    return dt >= b.start && dt <= b.end;
  }

  // ---------- Hydrate ----------
  function hydrateRange(startISO, endISO) {
    return fetchItems(startISO, endISO).then(function (items) {
      var slots = items.map(function (it) {
        var day = weekdayIdx(it.startdate);
        var wk = view.weekStart ? Math.floor(((addDays(String(it.startdate).slice(0, 10), 0) || new Date()) - (addDays(view.weekStart, 0) || new Date())) / 86400000 / 7) : 0;
        return {
          itemId: it.id, title: it.title || "", origTitle: it.title || "",
          startdate: it.startdate, enddate: it.enddate,
          idCalendar: it.id_calendar, isFullday: !!it.is_fullday_item,
          dayIdx: day, weekIdx: (wk < 0 ? 0 : wk), time: timeFromISO(it.startdate),
          groups: (it.groups && it.groups.length) ? it.groups : writeGroups(),
          hasAtt: !!it.has_attachments, isEditable: it.is_editable !== false,
          isGym: isGymTitle(it.title), themaFiche: isThemaTitle(it.title),
          vak: state.settings[slotKeyStd(day, timeFromISO(it.startdate))] || "",
          description: "", origDescription: "",
          ficheContentId: null, ficheTitle: "", origFicheContentId: null, origFicheTitle: "",
          starttime: "", endtime: "", _hydrated: false
        };
      });
      var need = slots.filter(function (s) { return s.idCalendar !== "cal_holidays" && (s.hasAtt || !/^Lesuur\s*\d+$/.test(s.title)); });
      var chain = Promise.resolve();
      need.forEach(function (s) {
        chain = chain.then(function () {
          return fetchItemDetail(s.itemId).then(function (d) {
            if (!d) return;
            s.origDescription = d.description || ""; s.description = s.origDescription;
            var att = d.attachments && d.attachments[0];
            if (att && att.content) { s.origFicheContentId = att.content.id; s.ficheContentId = att.content.id; s.origFicheTitle = att.content.subject || ""; s.ficheTitle = s.origFicheTitle; }
            // The authoritative group id lives here (list groups are always empty); keep it.
            if (d.groups && d.groups.length) { s.groups = d.groups; if (ctx.groupId == null) ctx.groupId = firstGroupId(d.groups); }
            if (stripHtml(s.origDescription) === "Zie themafiche.") s.themaFiche = true;
            if (d.starttime) { s.starttime = d.starttime; if (!s.time) s.time = String(d.starttime).slice(0, 5); }
            s.endtime = d.endtime || ""; s._hydrated = true;
          }).catch(function () {});
        });
      });
      return chain.then(function () { return slots; });
    });
  }

  function buildCommitPlan(slots) {
    // Occurrence window = the loaded week window (same range used to GET /cal/items).
    var range = currentWeekRange();
    return slots.filter(function (s) { return s.isEditable && s.idCalendar !== "cal_holidays" && computeDirty(s); }).map(function (s) {
      var nd = descFor(s);
      var grps = writeGroupObjs(s.groups);
      // Questi rejects an empty title — keep a safe fallback for emptied slots.
      var title = s.title || "Lesuur";
      var startDay = s.startdate ? String(s.startdate).slice(0, 10) : undefined;
      var hasFiche = !s.isGym && !!s.ficheContentId;
      var body;
      if (s.isFullday) {
        // Full-day/thema item: is_fullday_item TRUE, keep the date span, NO times.
        body = {
          calendarId: s.idCalendar || ctx.calendarId, title: title, description: toHtmlDesc(nd), is_fullday_item: true,
          startdate: startDay, enddate: s.enddate ? String(s.enddate).slice(0, 10) : startDay,
          is_published_students: false, is_published_parents: false, groups: grps, participants: []
        };
      } else {
        // Normal lesuur: single day (start==end) + start/end times.
        var st = s.starttime || (timeFromISO(s.startdate) ? timeFromISO(s.startdate) + ":00" : undefined);
        var et = s.endtime || (timeFromISO(s.enddate) ? timeFromISO(s.enddate) + ":00" : undefined);
        body = {
          calendarId: s.idCalendar || ctx.calendarId, title: title, description: toHtmlDesc(nd), is_fullday_item: false,
          startdate: startDay, enddate: startDay,
          starttime: st, endtime: et,
          is_published_students: false, is_published_parents: false, groups: grps, participants: []
        };
      }
      // No fiche (emptied slot or gym) → send attachments:[] to DETACH any existing fiche
      // (otherwise the fiche keeps overriding the title). With a fiche, omit the key so the
      // separate POST /attachments survives.
      if (!hasFiche) body.attachments = [];
      return {
        itemId: s.itemId, label: (s.title || "lesuur") + " (" + DAY_ABBR[s.dayIdx] + " " + (s.time || "") + ", wk " + (s.weekIdx + 1) + ")",
        old: { title: s.origTitle, desc: s.origDescription, fiche: s.origFicheTitle || "(geen)" },
        neu: { title: s.title, desc: toHtmlDesc(nd), fiche: (s.isGym ? "(geen — gym)" : (s.ficheTitle || "(geen)")) },
        patchBody: body, range: range,
        fiche: (!s.isGym && s.ficheContentId) ? { contentId: s.ficheContentId, groups: grps } : null
      };
    });
  }

  // ---------- UI state ----------
  var els = {};
  var DAY_NAMES = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
  var DAY_ABBR = ["ma", "di", "wo", "do", "vr"];
  // Time rows, break bands, and no-school cells are all derived from live data
  // (see computeTimeRows / breakLabelAfter / isNoSchool) — no hardcoded clock.
  function mkViewPanel() { return { source: "self", sortDir: "az", filterVak: null, filterTagId: null, unionMode: true, subTagId: null, picked: {}, search: "", loading: false, hideUsed: false, gradeFilter: null }; }
  var view = {
    weekStart: null, weeks: 1, weekOffset: 0,
    slots: [], timeRows: [], rowMeta: {}, presence: {}, ficheGroups: [], tags: [], ownTags: [], people: [],
    ownTopTags: [], ficheCache: {}, targetSlots: [], vakTagMap: {},
    selectedSlotId: null, undoStack: [], dragVakTag: null, allByOwner: {},
    panels: [mkViewPanel(), mkViewPanel(), mkViewPanel()]
  };

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k === "style") e.setAttribute("style", attrs[k]);
      else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function elId(id) { return document.getElementById(id); }
  function setStatus(t) { var s = elId("qwp-status"); if (s) s.textContent = t; }
  function groupFor(ownerId) { return view.ficheGroups.filter(function (g) { return String(g.ownerId) === String(ownerId); })[0]; }
  function ownerName(id) { if (String(id) === String(myId())) return "Ik"; var c = state.colleagues.filter(function (x) { return x.id === id; })[0]; return c ? c.name : ("#" + id); }

  // ---------- Shell ----------
  function buildShell() {
    var side = h("div", { class: "qwp-side", id: "qwp-side" }, [
      h("div", { class: "qwp-side-grp" }, [
        h("div", { class: "qwp-side-lbl", text: "Weergave" }),
        h("div", { class: "qwp-seg", id: "qwp-weekseg" }, [
          h("button", { "data-w": "1", onclick: function () { setWeeks(1); }, text: "1 week" }),
          h("button", { "data-w": "2", onclick: function () { setWeeks(2); }, text: "2 weken" })
        ]),
        h("div", { class: "qwp-navrow" }, [
          h("button", { class: "qwp-btn qwp-ghost qwp-navbtn", onclick: prevWeek, title: "Vorige week", text: "←" }),
          h("button", { class: "qwp-btn qwp-ghost qwp-navbtn", onclick: thisWeek, title: "Deze week", text: "Deze week" }),
          h("button", { class: "qwp-btn qwp-ghost qwp-navbtn", onclick: nextWeek, title: "Volgende week", text: "→" })
        ]),
        h("button", { class: "qwp-side-btn", onclick: reloadAndRender, text: "Vernieuwen" })
      ]),
      h("div", { class: "qwp-side-grp" }, [
        h("div", { class: "qwp-side-lbl", text: "Filterpanelen" }),
        h("div", { class: "qwp-seg", id: "qwp-panelseg" }, [
          h("button", { "data-p": "1", onclick: function () { setPanelCount(1); }, text: "1" }),
          h("button", { "data-p": "2", onclick: function () { setPanelCount(2); }, text: "2" }),
          h("button", { "data-p": "3", onclick: function () { setPanelCount(3); }, text: "3" })
        ]),
        h("div", { class: "qwp-seg", id: "qwp-viewseg" }, [
          h("button", { "data-v": "list", onclick: function () { setPickerView("list"); }, text: "Lijst" }),
          h("button", { "data-v": "card", onclick: function () { setPickerView("card"); }, text: "Kaart" })
        ])
      ]),
      h("div", { class: "qwp-side-grp" }, [
        h("div", { class: "qwp-side-lbl", text: "Opties" }),
        h("button", { class: "qwp-side-btn", onclick: openInstellingen, text: "Instellingen" }),
        h("button", { class: "qwp-side-btn", onclick: openCopyPrevWeek, text: "Kopieer vorige week" }),
        h("button", { class: "qwp-side-btn", onclick: openColleaguePopover, text: "Collega's laden" }),
        h("button", { class: "qwp-side-btn", onclick: loadAllFiches, text: "Alle lesfiches laden" })
      ]),
      h("div", { class: "qwp-side-grp" }, [
        h("div", { class: "qwp-side-lbl", text: "Legende" }),
        legendRow("var(--accent)", "border", "blauwe rand = fiche gekoppeld"),
        legendRow("var(--change-weak)", "fill", "groen = gewijzigd"),
        legendRow("var(--thema-weak)", "fill", "geel = thema"),
        legendRow("var(--gym-weak)", "fill", "grijs = gym")
      ]),
      h("div", { class: "qwp-side-grp" }, [
        h("div", { class: "qwp-side-lbl", text: "Balans deze week" }),
        h("div", { class: "qwp-balance", id: "qwp-balance" })
      ]),
      // Commit controls pinned to the bottom; Info + status just above a divider.
      h("div", { class: "qwp-side-grp qwp-side-bottom" }, [
        h("button", { class: "qwp-side-btn qwp-undo", id: "qwp-undo", onclick: doUndo, title: "Laatste actie ongedaan maken (Ctrl+Z)", text: "Ongedaan maken" }),
        h("button", { class: "qwp-btn qwp-review qwp-side-btn", id: "qwp-review", onclick: openReview, text: "Controleer wijzigingen" }),
        h("button", { class: "qwp-btn qwp-commit qwp-side-btn", id: "qwp-commit", disabled: "true", onclick: doCommit, text: "Wegschrijven (vergrendeld)" }),
        h("button", { class: "qwp-btn qwp-ghost qwp-side-btn", onclick: hide, text: "Sluiten" }),
        h("div", { class: "qwp-side-sep" }),
        h("div", { class: "qwp-side-note", id: "qwp-side-note", text: "" }),
        h("span", { class: "qwp-status", id: "qwp-status", text: "Laden…" }),
        h("button", { class: "qwp-side-btn qwp-muted", id: "qwp-debug", onclick: openDiagnose, title: "Zelftest voor ontwikkelaars", text: "Debug" })
      ])
    ]);

    var content = h("div", { class: "qwp-content" }, [
      buildGlobalSearch(),
      h("div", { class: "qwp-ttwrap", id: "qwp-ttwrap" }),
      h("div", { class: "qwp-splitter", id: "qwp-splitter", title: "Sleep om te herschalen" }),
      h("div", { class: "qwp-pickers", id: "qwp-pickers" }, [buildPicker(0), buildPicker(1), buildPicker(2)])
    ]);

    var main = h("div", { class: "qwp-main" }, [side, content]);

    var page = h("div", { class: "qwp-page", id: "qwp-page" }, [main]);
    var overlay = h("div", { class: "qwp-overlay", id: "qwp-overlay" }, [page]);
    els.root = overlay; els.page = page;
    return overlay;
  }

  // Resolve any (own) tag id up to its top-level subject tag id.
  function topTagIdOf(tagId) {
    if (tagId == null || tagId === "") return null;
    var pool = ownTagsList(), byId = {};
    pool.forEach(function (t) { byId[t.id] = t; });
    var cur = byId[tagId], guard = 0;
    while (cur && cur.parent && String(cur.parent) !== "0" && byId[cur.parent] && guard++ < 20) cur = byId[cur.parent];
    return cur ? cur.id : tagId;
  }
  // Per-subject (top-level tag) filled-slot tally + planned/empty totals.
  function renderBalance() {
    var el = elId("qwp-balance"); if (!el) return; el.innerHTML = "";
    var counts = {}, filled = 0, empty = 0;
    view.slots.forEach(function (s) {
      if (s.idCalendar === "cal_holidays" || s.isFullday || isThemaTitle(s.title) || s.themaFiche) return;
      if (isNoSchool(s.dayIdx, s.time)) return;
      if (s.ficheContentId || s.isGym) {
        filled++;
        var label, color = null;
        if (s.isGym) label = "Gym";
        else {
          // Subject = the top-level tag, from the slot's vak or guessed from the title.
          var top = topTagIdOf(s.vak || guessVakTagFromTitle(s.title));
          label = top != null ? ((tagTitle("self", top) || "").trim() || "Overig") : "Overig";
          if (top != null) color = tagColor("self", top);
        }
        if (!counts[label]) counts[label] = { n: 0, color: color };
        counts[label].n++;
      } else if (isTargetable(s)) empty++;
    });
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b].n - counts[a].n || a.localeCompare(b); });
    if (!keys.length && !empty) { el.appendChild(h("div", { class: "qwp-balance-empty", text: "Nog niets gepland." })); return; }
    keys.forEach(function (k) {
      // Colour the label by the subject's questi tag colour.
      var vak = h("span", { class: "qwp-balance-vak", text: k });
      if (counts[k].color) vak.style.color = counts[k].color;
      el.appendChild(h("div", { class: "qwp-balance-row" }, [vak, h("span", { class: "qwp-balance-n", text: String(counts[k].n) })]));
    });
    el.appendChild(h("div", { class: "qwp-side-sep" }));
    el.appendChild(h("div", { class: "qwp-balance-tot", text: "Gepland " + filled + " · Leeg " + empty }));
  }

  function legendRow(color, kind, text) {
    var sw = h("span", { class: "qwp-legend-sw" + (kind === "border" ? " border" : "") });
    if (kind === "border") sw.style.borderColor = color; else sw.style.background = color;
    return h("div", { class: "qwp-legend-row" }, [sw, h("span", { class: "qwp-legend-t", text: text })]);
  }
  // Draggable calendar/lists splitter — set flex-basis on both, persist ratio.
  function applySplit() {
    var tt = elId("qwp-ttwrap"), pk = elId("qwp-pickers"); if (!tt || !pk) return;
    var r = Math.max(0.2, Math.min(0.8, state.splitRatio || 0.58));
    tt.style.flex = "1 1 " + (r * 100) + "%"; pk.style.flex = "1 1 " + ((1 - r) * 100) + "%";
  }
  function wireSplitter() {
    var sp = elId("qwp-splitter"); if (!sp) return;
    sp.onmousedown = function (e) {
      e.preventDefault();
      var content = sp.parentNode; var rect = content.getBoundingClientRect();
      function move(ev) {
        var r = (ev.clientY - rect.top) / rect.height;
        state.splitRatio = Math.max(0.2, Math.min(0.8, r)); applySplit();
      }
      function up() { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); saveState(); }
      document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    };
  }
  function setWeeks(n) { state.weeks = n; view.weeks = n; saveState(); syncWeekSeg(); reloadAndRender(); }
  function syncWeekSeg() { var seg = elId("qwp-weekseg"); if (!seg) return; Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) { b.classList.toggle("active", String(view.weeks) === b.getAttribute("data-w")); }); }
  function setPanelCount(n) { state.panelCount = n; saveState(); syncSegs(); renderAllPanels(); }
  function setPickerView(v) { state.pickerView = v; saveState(); syncSegs(); for (var i = 0; i < visiblePanelCount(); i++) renderPickList(i); }
  function syncSegs() {
    var ps = elId("qwp-panelseg"); if (ps) Array.prototype.forEach.call(ps.querySelectorAll("button"), function (b) { b.classList.toggle("active", String(state.panelCount) === b.getAttribute("data-p")); });
    var vs = elId("qwp-viewseg"); if (vs) Array.prototype.forEach.call(vs.querySelectorAll("button"), function (b) { b.classList.toggle("active", String(state.pickerView) === b.getAttribute("data-v")); });
  }

  // ---------- Week navigation ----------
  function prevWeek() { view.weekOffset -= view.weeks; reloadAndRender(); }
  function nextWeek() { view.weekOffset += view.weeks; reloadAndRender(); }
  function thisWeek() { view.weekOffset = 0; reloadAndRender(); }
  function renderRange() {
    var el = elId("qwp-range"); if (!el || !view.weekStart) return;
    var lastFri = (view.weeks - 1) * 7 + 4;
    el.textContent = "Ma " + ddmm(view.weekStart, 0) + " – Vr " + ddmm(view.weekStart, lastFri) + (view.weekOffset ? (" (" + (view.weekOffset > 0 ? "+" : "") + view.weekOffset + " wk)") : "");
  }

  // ---------- Timetable (single side-by-side matrix, fits viewport) ----------
  function hhmmToMin(s) { var m = /^(\d{1,2}):(\d{2})/.exec(s || ""); return m ? (+m[1] * 60 + +m[2]) : null; }
  // Derive time rows, per-row end times, and a (day|time) presence set from the
  // live items — nothing about the schedule is hardcoded.
  function computeTimeRows() {
    var set = {}, endAt = {}, presence = {};
    view.slots.forEach(function (s) {
      if (s.idCalendar === "cal_holidays") return;
      if (s.isFullday || isThemaTitle(s.title) || s.themaFiche) return;
      var t = s.time || (s.starttime ? String(s.starttime).slice(0, 5) : "");
      if (!t) return;
      set[t] = true;
      presence[s.dayIdx + "|" + t] = true;
      var e = (s.endtime ? String(s.endtime).slice(0, 5) : timeFromISO(s.enddate));
      if (e) { (endAt[t] = endAt[t] || {}); endAt[t][e] = (endAt[t][e] || 0) + 1; }
    });
    view.timeRows = Object.keys(set).sort();
    view.presence = presence;
    var rowMeta = {};
    view.timeRows.forEach(function (t) {
      var best = null, bestN = 0, m = endAt[t] || {};
      Object.keys(m).forEach(function (e) { if (m[e] > bestN) { bestN = m[e]; best = e; } });
      rowMeta[t] = { start: t, end: best };
    });
    view.rowMeta = rowMeta;
  }
  // Pauze/speeltijd after row index: a gap between this row's end and the next
  // row's start. Big gap = middagpauze, smaller = speeltijd. No hardcoded clock.
  function breakLabelAfter(idx) {
    var rows = view.timeRows; if (idx >= rows.length - 1) return null;
    var meta = view.rowMeta && view.rowMeta[rows[idx]];
    var end = hhmmToMin(meta && meta.end ? meta.end : rows[idx]);
    var nextStart = hhmmToMin(rows[idx + 1]);
    if (end == null || nextStart == null) return null;
    var gap = nextStart - end;
    if (gap < 10) return null;
    return gap >= 40 ? "middagpauze" : "speeltijd";
  }
  function slotAt(weekIdx, dayIdx, time) {
    return view.slots.filter(function (s) { return s.weekIdx === weekIdx && s.dayIdx === dayIdx && s.idCalendar !== "cal_holidays" && !(s.isFullday || isThemaTitle(s.title) || s.themaFiche) && (s.time || (s.starttime ? String(s.starttime).slice(0, 5) : "")) === time; })[0] || null;
  }
  // Whole-week theme slot (WO bucket vs Godsdienst bucket). Only a REAL all-day
  // item counts (is_fullday_item) — the theme rows exist only when Questi actually
  // carries such a multi-day field, never as an empty placeholder.
  function weekThemaSlot(weekIdx, kind) {
    return view.slots.filter(function (s) {
      if (s.weekIdx !== weekIdx || s.idCalendar === "cal_holidays") return false;
      if (!s.isFullday) return false;
      var gd = GD_RE.test(s.title || "");
      return kind === "gd" ? gd : !gd;
    })[0] || null;
  }
  // A theme row of this kind is shown only if some loaded week has a real all-day item.
  function hasThemaKind(kind) { for (var w = 0; w < view.weeks; w++) if (weekThemaSlot(w, kind)) return true; return false; }
  // A cell is "geen school" when no item exists for that weekday+time anywhere in
  // the loaded weeks (e.g. a half-day) — distinct from a schedulable empty slot,
  // which has a placeholder item. Data-driven, adapts to any timetable.
  function isNoSchool(dayIdx, timeLabel) {
    if (!/^\d{2}:\d{2}$/.test(timeLabel)) return false;
    if (!view.presence || !Object.keys(view.presence).length) return false;
    return !view.presence[dayIdx + "|" + timeLabel];
  }

  // Full Dutch date label, e.g. "zaterdag 4 juli 2026".
  var DAY_FULL_NL = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
  var MONTH_NL = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  function fullDateLabel(offsetDays) {
    var d = addDays(view.weekStart, offsetDays); if (!d) return "";
    return DAY_FULL_NL[(d.getDay() + 6) % 7] + " " + d.getDate() + " " + MONTH_NL[d.getMonth()] + " " + d.getFullYear();
  }

  function renderTimetable() {
    var wrap = elId("qwp-ttwrap"); if (!wrap) return; wrap.innerHTML = "";
    computeTimeRows();
    renderRange();

    var grid = h("div", { class: "qwp-tt" });
    // Time column fixed 64px; the 10 day columns (both weeks) share the rest via
    // minmax(0,1fr) so two weeks always fit inside the viewport (no h-scroll).
    grid.style.gridTemplateColumns = "64px repeat(" + (5 * view.weeks) + ", minmax(0, 1fr))";

    // No week caption band — the wk-sep divider line separates the two weeks,
    // and each day already shows its own full date.

    // Day-header row — centered full Dutch date "maandag 29 juni 2026".
    grid.appendChild(h("div", { class: "qwp-tt-corner" }, [h("span", { class: "qwp-tt-corner-lbl", text: "uur" })]));
    for (var wh = 0; wh < view.weeks; wh++) {
      for (var d = 0; d < 5; d++) {
        grid.appendChild(h("div", { class: "qwp-tt-dayhd" + (d === 0 && wh > 0 ? " wk-sep" : "") }, [
          h("span", { class: "qwp-tt-daydate", text: fullDateLabel(wh * 7 + d) })
        ]));
      }
    }

    // Theme rows: only when Questi actually has an all-day WO/Gods item this range.
    if (hasThemaKind("wo")) appendThemaRow(grid, "WO", "wo");
    if (hasThemaKind("gd")) appendThemaRow(grid, "Gods", "gd");

    // Lesuur rows with pauze/speeltijd gap bands (both derived from live times).
    view.timeRows.forEach(function (t, idx) {
      grid.appendChild(h("div", { class: "qwp-tt-timelbl", text: t }));
      for (var wr = 0; wr < view.weeks; wr++) {
        for (var dd = 0; dd < 5; dd++) {
          if (isNoSchool(dd, t)) grid.appendChild(noSchoolCell(dd, wr));
          else grid.appendChild(cellFor(slotAt(wr, dd, t), wr, dd, t));
        }
      }
      var brk = breakLabelAfter(idx);
      if (brk) {
        var band = h("div", { class: "qwp-tt-break" }, [h("span", { text: brk })]);
        band.style.gridColumn = "1 / -1";
        grid.appendChild(band);
      }
    });

    wrap.appendChild(grid);
    syncWeekSeg();
    renderBalance();
    refreshUndoBtn();
  }

  function appendThemaRow(grid, label, kind) {
    grid.appendChild(h("div", { class: "qwp-tt-themalbl", text: label }));
    for (var w = 0; w < view.weeks; w++) {
      var s = weekThemaSlot(w, kind);
      var cell;
      if (s) { cell = cellFor(s, w, 0, "thema"); }
      else { cell = h("div", { class: "qwp-cell empty thema-span", title: label }, [h("div", { class: "qwp-cell-empty-hint", text: "—" })]); }
      cell.classList.add("thema-span");
      cell.style.gridColumn = "span 5";
      if (w > 0) cell.classList.add("wk-sep");
      grid.appendChild(cell);
    }
  }

  // No lesson-start here this day → a quiet blank cell (the shared time-axis means
  // a longer block on another day leaves a hole; don't shout "geen school").
  function noSchoolCell(dayIdx, weekIdx) {
    var sepCls = (dayIdx === 0 && weekIdx > 0) ? " wk-sep" : "";
    return h("div", { class: "qwp-cell blank" + sepCls });
  }

  // A targetable slot = an editable, empty (no fiche/gym/thema) lesuur — the only
  // kind you can drop a fiche onto or mark as a mass-add target.
  function isTargetable(s) { return s && s.isEditable && s.idCalendar !== "cal_holidays" && !s.ficheContentId && !s.isGym && !s.themaFiche && !isThemaTitle(s.title); }
  function isTarget(itemId) { return view.targetSlots.indexOf(itemId) > -1; }
  function toggleTarget(itemId) {
    var i = view.targetSlots.indexOf(itemId);
    if (i > -1) view.targetSlots.splice(i, 1); else view.targetSlots.push(itemId);
    renderTimetable(); updateTargetHint();
  }
  function clearTargets() { view.targetSlots = []; }
  function updateTargetHint() {
    var el = elId("qwp-side-note"); if (!el) return;
    var n = view.targetSlots.length;
    if (n) el.textContent = n + " doel" + (n === 1 ? "" : "en") + " gekozen — kies fiches en klik 'Add selectie'.";
  }
  // Drag affordance: highlight every valid empty slot while a card is dragged, and
  // give slots whose Instellingen vak matches the dragged tag a stronger highlight.
  function startDragTargets(tagId) {
    if (!els.root) return;
    els.root.classList.add("qwp-dragging");
    view.dragVakTag = (tagId != null && tagId !== "") ? String(tagId) : null;
    if (view.dragVakTag) {
      Array.prototype.forEach.call(els.root.querySelectorAll(".qwp-cell.slot-empty"), function (c) {
        if (c.getAttribute("data-vak") === view.dragVakTag) c.classList.add("vak-match");
      });
    }
  }
  function endDragTargets() {
    if (!els.root) return;
    els.root.classList.remove("qwp-dragging");
    view.dragVakTag = null;
    Array.prototype.forEach.call(els.root.querySelectorAll(".qwp-cell.vak-match"), function (c) { c.classList.remove("vak-match"); });
  }

  function cellFor(s, weekIdx, dayIdx, timeLabel) {
    var sepCls = (dayIdx === 0 && weekIdx > 0) ? " wk-sep" : "";
    if (!s) {
      return h("div", {
        class: "qwp-cell empty" + sepCls,
        title: "Geen lesitem op dit tijdslot",
        onclick: function () { setStatus("Geen lesitem op " + DAY_NAMES[dayIdx] + " " + (timeLabel === "thema" ? "(thema)" : timeLabel) + " in week " + (weekIdx + 1) + " — niets te bewerken."); }
      }, [h("div", { class: "qwp-cell-empty-hint", text: "leeg" })]);
    }
    var dirty = computeDirty(s);
    var thema = s.themaFiche || isThemaTitle(s.title);
    var targetable = isTargetable(s);
    var cls = "qwp-cell" + sepCls;
    if (view.selectedSlotId === s.itemId) cls += " sel";
    if (dirty) cls += " dirty";
    if (s.origFicheContentId) cls += " hasexisting";
    if (s.isGym) cls += " isgym";
    if (thema) cls += " isthema";
    if (targetable) cls += " slot-empty";
    if (targetable && isTarget(s.itemId)) cls += " target";

    var fiche = s.isGym ? "Enkel titel (gym)" : thema ? "Zie themafiche."
      : (s.ficheTitle || (s.origFicheTitle ? ("was: " + s.origFicheTitle) : "Klik of sleep om te kiezen"));
    // No status pills — color conveys state (see sidebar legend). s.vak = live tag id.
    var vakLbl = s.vak ? ((tagTitle("self", s.vak) || "").trim()) : "";

    // Targetable empty slot: single click toggles it as a mass-add target;
    // double click opens the popup. Filled/gym/thema: single click opens popup.
    var onclick = targetable ? function () { toggleTarget(s.itemId); } : function () { openSlotPopup(s); };
    var ondbl = targetable ? function () { openSlotPopup(s); } : null;

    var cell = h("div", {
      class: cls, title: targetable ? "Klik = doel voor 'Add selectie' · dubbelklik = handmatig kiezen" : (s.title || ""),
      "data-vak": (state.settings[slotKeyStd(s.dayIdx, s.time)] || ""),
      onclick: onclick, ondblclick: ondbl,
      ondragover: function (e) { e.preventDefault(); cell.classList.add("drop"); },
      ondragleave: function () { cell.classList.remove("drop"); },
      ondrop: function (e) {
        e.preventDefault(); cell.classList.remove("drop"); endDragTargets();
        try {
          var dd = JSON.parse(e.dataTransfer.getData("text/plain"));
          if (dd && dd.kind === "slot") {
            var src = slotById(dd.itemId); if (!src || src === s) return;
            pushUndo("lesuur verplaatsen"); moveOrSwap(src, s);
          } else {
            pushUndo("fiche slepen"); assignFiche(s, { id: dd.id, subject: dd.subject || dd.title }); if (dd.tagId != null) s.vak = dd.tagId;
          }
          renderTimetable();
        } catch (err) {}
      }
    }, [
      vakLbl ? h("div", { class: "qwp-cell-top" }, [h("span", { class: "qwp-cell-vak", text: vakLbl })]) : null,
      h("div", { class: "qwp-cell-title", text: s.title || "(leeg)" }),
      h("div", { class: "qwp-cell-fiche", text: fiche })
    ]);
    // Filled (non-thema) slots are draggable → move/swap onto another slot.
    var movable = !!(s.ficheContentId || s.isGym) && !thema;
    if (movable) {
      cell.setAttribute("draggable", "true");
      cell.classList.add("movable");
      cell.ondragstart = function (e) { e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "slot", itemId: s.itemId })); startDragTargets(s.vak ? (+s.vak) : null); };
      cell.ondragend = function () { endDragTargets(); };
    }
    return cell;
  }

  // Assigning a fiche fully replaces the lesson: the slot title BECOMES the fiche
  // title (so a drop/replace visibly + on-commit renames the lesuur).
  function assignFiche(slot, f) { var t = f.subject || f.title || ""; slot.ficheContentId = f.id; slot.ficheTitle = t; if (t) slot.title = t; slot.isGym = false; slot.themaFiche = false; }
  // Move / swap a fiche between two slots (drag one filled cell onto another) — the
  // title travels with the fiche.
  function slotPayload(s) { return { title: s.title, ficheContentId: s.ficheContentId, ficheTitle: s.ficheTitle, isGym: s.isGym, vak: s.vak }; }
  function applySlotPayload(s, p) { s.title = p.title; s.ficheContentId = p.ficheContentId; s.ficheTitle = p.ficheTitle; s.isGym = p.isGym; s.themaFiche = false; s.vak = p.vak; }
  function clearSlotContent(s) { s.title = s.origTitle; s.ficheContentId = null; s.ficheTitle = ""; s.isGym = false; s.themaFiche = false; s.vak = state.settings[slotKeyStd(s.dayIdx, s.time)] || ""; }
  // Fully empty a slot: drop the fiche AND wipe title/description (commit writes it blank).
  function emptySlot(s) { s.title = ""; s.description = ""; s.ficheContentId = null; s.ficheTitle = ""; s.isGym = false; s.themaFiche = false; s.vak = ""; }
  function moveOrSwap(src, dst) {
    var a = slotPayload(src), b = slotPayload(dst);
    var dstFilled = !!(dst.ficheContentId || dst.isGym);
    applySlotPayload(dst, a);
    if (dstFilled) applySlotPayload(src, b); else clearSlotContent(src);
  }

  // ---------- Slot popup ----------
  function openSlotPopup(s) {
    view.selectedSlotId = s.itemId; renderTimetable();
    var old = elId("qwp-modal"); if (old) old.remove();

    // Vak dropdown = the user's LIVE top tags (server-side fetch by tag), so the
    // search only ever shows fiches actually under that tag — no title-regex leak.
    var tops = panelTopTags("self");
    // s.vak holds a live top-tag id; if unset, pre-select the guess from the title.
    var curTagId = (s.vak ? (+s.vak) : guessVakTagFromTitle(s.title));
    var vakSel = h("select", { class: "qwp-input", id: "qwp-pop-vak" },
      [h("option", { value: "", text: "— kies vak —" })].concat(tops.map(function (t) { return h("option", { value: t.id, text: (t.title || "").trim(), selected: (String(curTagId) === String(t.id) ? "selected" : null) }); })));
    var searchInp = h("input", { class: "qwp-input", id: "qwp-pop-search", placeholder: "Zoek in eigen lesfiches…", value: (s.ficheTitle || "") });
    var results = h("div", { class: "qwp-results", id: "qwp-pop-results" });
    var gymChk = h("input", { type: "checkbox" }); if (s.isGym) gymChk.checked = true;

    function renderResults() {
      results.innerHTML = "";
      var noVak = (curTagId == null);
      // No vak → search the full own library (loaded via tag 5); else the tag's fiches.
      var items = (noVak ? ((groupFor(myId()) || { items: [] }).items || []) : (view.ficheCache[cacheKey("self", curTagId)] || [])).slice();
      var term = searchInp.value.trim().toLowerCase();
      if (noVak && !term) { results.appendChild(h("div", { class: "qwp-result", text: "Typ om in al je lesfiches te zoeken, of kies een vak." })); return; }
      if (term) items = items.filter(function (f) { return (f.subject || "").toLowerCase().indexOf(term) > -1; });
      items.sort(function (a, b) { return (a.subject || "").localeCompare(b.subject || "", undefined, { numeric: true }); });
      items.slice(0, 300).forEach(function (f) {
        results.appendChild(h("div", {
          class: "qwp-result", onclick: function () { pushUndo("fiche toewijzen"); assignFiche(s, f); s.vak = (curTagId != null ? curTagId : (guessVakTagFromTitle(f.subject) || s.vak)); searchInp.value = f.subject || ""; renderTimetable(); setStatus("Toegewezen: " + (f.subject || "")); }
        }, [h("span", { class: "qwp-result-t", text: f.subject || "(zonder titel)" }), usedThisYear(f) ? h("span", { class: "qwp-used", text: "gebruikt" }) : null]));
      });
      if (!items.length) results.appendChild(h("div", { class: "qwp-result", text: noVak ? "Geen fiches gevonden." : "Geen fiches in dit vak." }));
    }
    function refresh() {
      if (curTagId == null) { renderResults(); return; }
      if (view.ficheCache[cacheKey("self", curTagId)]) { renderResults(); return; }
      results.innerHTML = ""; results.appendChild(h("div", { class: "qwp-result", text: "Laden…" }));
      ensureFiches("self", curTagId).then(renderResults);
    }
    vakSel.onchange = function () {
      curTagId = vakSel.value ? (+vakSel.value) : null;
      s.vak = curTagId != null ? curTagId : "";
      s.themaFiche = curTagId != null && isThemaTitle(tagTitle("self", curTagId));
      refresh();
    };
    searchInp.oninput = renderResults;
    gymChk.onchange = function () { pushUndo("gym"); s.isGym = gymChk.checked; if (s.isGym) { s.ficheContentId = null; s.ficheTitle = ""; searchInp.value = ""; } };

    var modal = h("div", { class: "qwp-modal", id: "qwp-modal" }, [
      h("div", { class: "qwp-modal-box" }, [
        h("div", { class: "qwp-modal-hd", text: (s.title || "Lesuur") + " · " + DAY_NAMES[s.dayIdx] + " " + (s.time || "") + " · week " + (s.weekIdx + 1) }),
        h("div", { class: "qwp-modal-body" }, [
          h("div", { class: "qwp-field" }, [h("label", { text: "Vak" }), vakSel]),
          h("div", { class: "qwp-field" }, [h("label", { text: "Lesfiche (titel / zoeken)" }), searchInp]),
          h("div", { class: "qwp-field" }, [results]),
          h("div", { class: "qwp-field" }, [h("label", { class: "qwp-check" }, [gymChk, h("span", { text: "Lichamelijke opvoeding / zwemmen (enkel titel, geen fiche)" })])])
        ]),
        h("div", { class: "qwp-modal-ft" }, [
          h("button", { class: "qwp-btn qwp-ghost", text: "Leegmaken", title: "Verwijder fiche + titel + omschrijving", onclick: function () { pushUndo("lesuur leegmaken"); emptySlot(s); modal.remove(); renderTimetable(); } }),
          h("button", { class: "qwp-btn", text: "Klaar", onclick: function () { modal.remove(); renderTimetable(); } })
        ])
      ])
    ]);
    els.page.appendChild(modal);
    setTimeout(function () { searchInp.focus(); }, 0);
    refresh();
  }

  // ---------- Bottom filter panels (1-3, list/card, real-tag pills) ----------
  function ownTagsList() { return _ownTagsCache || []; }
  function sharedTagsList() { return _sharedTagsCache || []; }
  function tagPoolFor(source) { return isOwnSource(source) ? ownTagsList() : sharedTagsList(); }
  // A colleague's own top "Alle" tag (for their /lessons fetch); 8 = last resort.
  function colleagueDefaultTag(ownerId) { var t = topTagsForOwner(sharedTagsList(), ownerId); return t.length ? t[0].id : ALL_FICHES_TAG; }
  function panelTopTags(source) {
    if (isOwnSource(source)) return topTagsForOwner(ownTagsList(), ctx.ownerId);
    var t = topTagsForOwner(sharedTagsList(), source);
    // Universal "Alle" fallback for a colleague with no own top tag exposed.
    if (!t.length) t = [{ id: ALL_FICHES_TAG, title: "Alle lesfiches", type: "default", parent: 0 }];
    return t;
  }
  function childTags(parentId, source) {
    return tagPoolFor(source).filter(function (t) { return String(t.parent) === String(parentId); })
      .sort(function (a, b) { return (a.title || "").trim().localeCompare((b.title || "").trim(), undefined, { numeric: true }); });
  }
  function tagTitle(source, tagId) { var p = tagPoolFor(source); for (var i = 0; i < p.length; i++) if (String(p[i].id) === String(tagId)) return p[i].title; return ""; }
  // Questi tag color (hex) — used for drawer accent, pill dots, modal subject dots.
  function tagColor(source, tagId) { var p = tagPoolFor(source); for (var i = 0; i < p.length; i++) if (String(p[i].id) === String(tagId)) return p[i].color || null; return null; }
  function defaultTopTagId(source) { var t = panelTopTags(source); return t.length ? t[0].id : null; }

  // ---------- Global cross-owner search bar ----------
  function buildGlobalSearch() {
    return h("div", { class: "qwp-gsearch", id: "qwp-globalsearch" }, [
      h("input", { class: "qwp-gsearch-inp", id: "qwp-gsearch-inp", placeholder: "Zoek in alle lesfiches (ik + collega's)…", oninput: runGlobalSearch }),
      h("select", { class: "qwp-select qwp-gsearch-owner", id: "qwp-gsearch-owner", onchange: runGlobalSearch }),
      h("span", { class: "qwp-gsearch-hint", text: "sleep resultaat op een lesuur" }),
      h("div", { class: "qwp-gsearch-results", id: "qwp-gsearch-results" })
    ]);
  }
  function renderGlobalOwners() {
    var sel = elId("qwp-gsearch-owner"); if (!sel) return;
    var cur = sel.value || "all"; sel.innerHTML = "";
    sel.appendChild(h("option", { value: "all", text: "Iedereen" }));
    sel.appendChild(h("option", { value: String(myId()), text: "Ik" }));
    state.colleagues.forEach(function (c) { sel.appendChild(h("option", { value: String(c.id), text: c.name })); });
    sel.value = cur;
  }
  // Full fiche list per owner, fetched once on demand and cached.
  function ensureAllFiches(ownerId) {
    var key = String(ownerId);
    if (view.allByOwner[key]) return Promise.resolve(view.allByOwner[key]);
    return fetchAllFiches(ownerId).then(function (r) { view.allByOwner[key] = r.items; return r.items; });
  }
  function closeGlobalResults() { var r = elId("qwp-gsearch-results"); if (r) { r.innerHTML = ""; r.classList.remove("open"); } }
  function runGlobalSearch() {
    var inp = elId("qwp-gsearch-inp"), res = elId("qwp-gsearch-results"); if (!inp || !res) return;
    var term = inp.value.trim().toLowerCase();
    if (term.length < 2) { closeGlobalResults(); return; }
    var ownerSel = (elId("qwp-gsearch-owner") || {}).value || "all";
    var owners = [];
    if (ownerSel === "all" || ownerSel === String(myId())) owners.push(myId());
    state.colleagues.forEach(function (c) { if (ownerSel === "all" || ownerSel === String(c.id)) owners.push(c.id); });
    res.classList.add("open"); res.innerHTML = ""; res.appendChild(h("div", { class: "qwp-gsearch-msg", text: "Zoeken…" }));
    Promise.all(owners.map(ensureAllFiches)).then(function (lists) {
      // Guard against a stale async result if the term changed meanwhile.
      if (inp.value.trim().toLowerCase() !== term) return;
      var rows = [];
      owners.forEach(function (oid, i) { (lists[i] || []).forEach(function (f) { if ((f.subject || "").toLowerCase().indexOf(term) > -1) rows.push({ f: f, owner: oid }); }); });
      rows.sort(function (a, b) { return (a.f.subject || "").localeCompare(b.f.subject || "", undefined, { numeric: true }); });
      res.innerHTML = "";
      if (!rows.length) { res.appendChild(h("div", { class: "qwp-gsearch-msg", text: "Geen resultaten." })); return; }
      rows.slice(0, 60).forEach(function (r) {
        var pickData = { id: r.f.id, subject: r.f.subject, tagId: (String(r.owner) === String(myId()) ? guessVakTagFromTitle(r.f.subject) : null), owner: r.owner };
        var row = h("div", {
          class: "qwp-gsearch-row", draggable: "true", title: r.f.subject || "",
          ondragstart: function (e) { e.dataTransfer.setData("text/plain", JSON.stringify(pickData)); startDragTargets(pickData.tagId); },
          ondragend: function () { endDragTargets(); },
          onclick: function () { assignFromGlobal(r.f); }
        }, [
          h("span", { class: "qwp-gsearch-t", text: r.f.subject || "(zonder titel)" }),
          h("span", { class: "qwp-gsearch-badge", text: ownerName(r.owner) })
        ]);
        res.appendChild(row);
      });
      if (rows.length > 60) res.appendChild(h("div", { class: "qwp-gsearch-msg", text: rows.length + " resultaten — verfijn je zoekterm (eerste 60 getoond)." }));
    }).catch(function () { res.innerHTML = ""; res.appendChild(h("div", { class: "qwp-gsearch-msg", text: "Zoeken mislukt." })); });
  }
  function assignFromGlobal(f) {
    var s = view.selectedSlotId ? slotById(view.selectedSlotId) : null;
    if (!s || !isTargetable(s)) { setStatus("Sleep de fiche op een leeg lesuur (of open eerst een lesuur)."); return; }
    pushUndo("fiche toewijzen (zoek)");
    assignFiche(s, { id: f.id, subject: f.subject });
    var g = guessVakTagFromTitle(f.subject); if (g) s.vak = g;
    renderTimetable(); setStatus("Toegewezen: " + (f.subject || ""));
  }

  function buildPicker(pi) {
    return h("div", { class: "qwp-picker", id: "qwp-picker-" + pi }, [
      h("div", { class: "qwp-picker-hd" }, [
        h("div", { class: "qwp-vaktoggle", id: "qwp-vaktoggle-" + pi }),
        h("div", { class: "qwp-picker-tools" }, [
          h("input", { class: "qwp-psearch", id: "qwp-search-" + pi, placeholder: "zoek…", oninput: function (e) { view.panels[pi].search = e.target.value; renderPickList(pi); } }),
          h("select", {
            class: "qwp-select", id: "qwp-source-" + pi, onchange: function (e) {
              var v = isNaN(+e.target.value) ? e.target.value : +e.target.value;
              var p = view.panels[pi]; p.source = v; state.panels[pi].source = v;
              p.filterVak = defaultTopTagId(v); p.filterTagId = p.filterVak; p.unionMode = true; state.panels[pi].filterVak = p.filterVak; saveState();
              renderVakToggle(pi); renderSubcats(pi); loadAndRenderList(pi);
            }
          }),
          h("button", {
            class: "qwp-btn qwp-ghost qwp-sm", id: "qwp-sortbtn-" + pi, onclick: function () {
              var p = view.panels[pi]; p.sortDir = (p.sortDir === "az" ? "za" : "az"); state.panels[pi].sortDir = p.sortDir; saveState(); renderPickList(pi);
            }, text: "A-Z"
          }),
          h("select", {
            class: "qwp-select qwp-grade", id: "qwp-grade-" + pi, onchange: function (e) {
              var p = view.panels[pi]; p.gradeFilter = e.target.value || null; state.panels[pi].gradeFilter = p.gradeFilter; saveState(); renderPickList(pi);
            }
          }),
          h("button", {
            class: "qwp-btn qwp-ghost qwp-sm", id: "qwp-hideused-" + pi, title: "Verberg gebruikte lesfiches", onclick: function () {
              var p = view.panels[pi]; p.hideUsed = !p.hideUsed; state.panels[pi].hideUsed = p.hideUsed; saveState(); renderPickList(pi);
            }, text: "Verberg gebruikt"
          })
        ])
      ]),
      h("div", { class: "qwp-subcats", id: "qwp-subcats-" + pi }),
      h("div", { class: "qwp-picker-list", id: "qwp-picker-list-" + pi }),
      h("div", { class: "qwp-picker-ft" }, [
        h("span", { class: "qwp-pick-count", id: "qwp-pick-count-" + pi, text: "0 geselecteerd" }),
        h("span", { class: "qwp-spacer" }),
        h("button", { class: "qwp-btn qwp-ghost qwp-sm", id: "qwp-clearsel-" + pi, onclick: function () { view.panels[pi].picked = {}; renderPickList(pi); updatePickCount(pi); }, text: "Wis selectie" }),
        h("button", { class: "qwp-btn", id: "qwp-addsel-" + pi, onclick: function () { openMassAdd(pi); }, text: "Add selectie" })
      ])
    ]);
  }
  function visiblePanelCount() { return Math.max(1, Math.min(3, state.panelCount || 2)); }
  function cardCols() { var n = visiblePanelCount(); return n === 1 ? 8 : (n === 2 ? 3 : 2); }
  function applyPanelVisibility() {
    var n = visiblePanelCount();
    for (var i = 0; i < 3; i++) { var el = elId("qwp-picker-" + i); if (el) el.style.display = (i < n) ? "" : "none"; }
  }
  function renderPanel(pi) { renderVakToggle(pi); renderSource(pi); renderSubcats(pi); applyPanelAccent(pi); loadAndRenderList(pi); }
  function renderAllPanels() { applyPanelVisibility(); for (var i = 0; i < visiblePanelCount(); i++) renderPanel(i); }

  // Tint the drawer with the active vak's tag color.
  function applyPanelAccent(pi) {
    var el = elId("qwp-picker-" + pi); if (!el) return;
    var p = view.panels[pi]; var c = tagColor(p.source, p.filterVak);
    el.style.setProperty("--vak-accent", c || "var(--line)");
  }
  function renderVakToggle(pi) {
    var wrap = elId("qwp-vaktoggle-" + pi); if (!wrap) return; wrap.innerHTML = "";
    var p = view.panels[pi];
    var tops = panelTopTags(p.source);
    if (p.filterVak == null && tops.length) { p.filterVak = tops[0].id; p.filterTagId = p.filterVak; p.unionMode = true; }
    tops.forEach(function (t) {
      var dot = h("span", { class: "qwp-vakdot" }); if (t.color) dot.style.background = t.color;
      wrap.appendChild(h("button", {
        class: "qwp-vakbtn" + (String(p.filterVak) === String(t.id) ? " active" : ""), onclick: function () {
          p.filterVak = t.id; p.filterTagId = t.id; p.unionMode = true; state.panels[pi].filterVak = t.id; saveState();
          renderVakToggle(pi); renderSubcats(pi); applyPanelAccent(pi); loadAndRenderList(pi);
        }
      }, [dot, h("span", { text: (t.title || "").trim() })]));
    });
  }
  function renderSource(pi) {
    var sel = elId("qwp-source-" + pi); if (!sel) return; sel.innerHTML = "";
    var owners = [{ id: myId(), name: "Ik" }].concat(state.colleagues);
    owners.forEach(function (o) { sel.appendChild(h("option", { value: o.id, text: o.name, selected: (String(view.panels[pi].source) === String(o.id) ? "selected" : null) })); });
  }
  function renderSubcats(pi) {
    var wrap = elId("qwp-subcats-" + pi); if (!wrap) return; wrap.innerHTML = "";
    var p = view.panels[pi];
    var subs = childTags(p.filterVak, p.source);
    if (!subs.length) { p.unionMode = false; p.filterTagId = p.filterVak; return; }
    // "Alle" = union (parent + all children); "Geen subtag" = parent-only; then each child.
    wrap.appendChild(h("button", { class: "qwp-subchip" + (p.unionMode ? " active" : ""), onclick: function () { p.unionMode = true; renderSubcats(pi); loadAndRenderList(pi); }, text: "Alle" }));
    wrap.appendChild(h("button", { class: "qwp-subchip" + ((!p.unionMode && String(p.filterTagId) === String(p.filterVak)) ? " active" : ""), onclick: function () { p.unionMode = false; p.filterTagId = p.filterVak; renderSubcats(pi); loadAndRenderList(pi); }, text: "Geen subtag" }));
    subs.forEach(function (t) { wrap.appendChild(h("button", { class: "qwp-subchip" + ((!p.unionMode && String(p.filterTagId) === String(t.id)) ? " active" : ""), onclick: function () { p.unionMode = false; p.filterTagId = t.id; renderSubcats(pi); loadAndRenderList(pi); }, text: (t.title || "").trim() })); });
  }
  // Ensure the (source, tag) fiches are fetched, then render — with a loading state.
  function loadAndRenderList(pi) {
    var p = view.panels[pi];
    if (p.filterVak == null) { renderPickList(pi); return; }
    if (view.ficheCache[panelCacheKey(p)]) { renderPickList(pi); return; }
    p.loading = true; renderPickList(pi);
    var prom = p.unionMode
      ? ensureFichesUnion(p.source, p.filterVak, childTags(p.filterVak, p.source).map(function (t) { return t.id; }))
      : ensureFiches(p.source, p.filterTagId);
    prom.then(function () { p.loading = false; renderPickList(pi); });
  }
  function ficheGrades(f) { var g = f && f.grades; return Array.isArray(g) ? g : []; }
  function panelGradeOptions(pi) {
    var p = view.panels[pi];
    var set = {};
    (view.ficheCache[panelCacheKey(p)] || []).forEach(function (f) { ficheGrades(f).forEach(function (g) { if (g) set[g] = true; }); });
    return Object.keys(set).sort();
  }
  function renderGradeSelect(pi) {
    var sel = elId("qwp-grade-" + pi); if (!sel) return;
    var p = view.panels[pi], opts = panelGradeOptions(pi);
    sel.innerHTML = "";
    sel.appendChild(h("option", { value: "", text: "Alle leerjaren", selected: (p.gradeFilter ? null : "selected") }));
    opts.forEach(function (g) { sel.appendChild(h("option", { value: g, text: g, selected: (p.gradeFilter === g ? "selected" : null) })); });
  }
  function pickListItems(pi) {
    var p = view.panels[pi];
    var items = (view.ficheCache[panelCacheKey(p)] || []).slice();
    if (p.hideUsed) items = items.filter(function (f) { return !usedThisYear(f); });
    if (p.gradeFilter) items = items.filter(function (f) { return ficheGrades(f).indexOf(p.gradeFilter) > -1; });
    var term = p.search.trim().toLowerCase();
    if (term) items = items.filter(function (f) { return (f.subject || "").toLowerCase().indexOf(term) > -1; });
    items.sort(function (a, b) { var r = (a.subject || "").localeCompare(b.subject || "", undefined, { numeric: true }); return p.sortDir === "az" ? r : -r; });
    return items;
  }
  function renderPickList(pi) {
    var p = view.panels[pi];
    var sb = elId("qwp-sortbtn-" + pi); if (sb) sb.textContent = p.sortDir === "az" ? "A-Z" : "Z-A";
    var hb = elId("qwp-hideused-" + pi); if (hb) hb.classList.toggle("active", !!p.hideUsed);
    renderGradeSelect(pi);
    var list = elId("qwp-picker-list-" + pi); if (!list) return; list.innerHTML = "";
    list.className = "qwp-picker-list " + (state.pickerView === "card" ? "card" : "list");
    // Card columns scale with the visible-panel count (1→8, 2→3, 3→2) so cards stay wide.
    list.style.gridTemplateColumns = (state.pickerView === "card") ? ("repeat(" + cardCols() + ", minmax(0, 1fr))") : "";
    if (p.loading) { list.appendChild(h("div", { class: "qwp-empty", text: "Laden…" })); updatePickCount(pi); return; }
    var items = pickListItems(pi);
    if (!items.length) { list.appendChild(h("div", { class: "qwp-empty", text: "Geen lesfiches voor dit filter." })); updatePickCount(pi); return; }
    var col = tagColor(p.source, p.filterVak);
    items.forEach(function (f) {
      var chk = h("input", { type: "checkbox" }); if (p.picked[f.id]) chk.checked = true;
      var pickData = { id: f.id, subject: f.subject, tagId: p.filterVak, color: col };
      var row = h("label", {
        class: "qwp-pfiche" + (p.picked[f.id] ? " picked" : ""), draggable: "true", title: f.subject || "",
        ondragstart: function (e) { e.dataTransfer.setData("text/plain", JSON.stringify(pickData)); startDragTargets(pickData.tagId); },
        ondragend: function () { endDragTargets(); }
      }, [
        chk,
        h("span", { class: "qwp-pfiche-t", text: f.subject || "(zonder titel)" }),
        usedThisYear(f) ? h("span", { class: "qwp-used", text: "gebruikt" }) : null
      ]);
      chk.onchange = function () { if (chk.checked) { p.picked[f.id] = pickData; } else { delete p.picked[f.id]; } row.classList.toggle("picked", chk.checked); updatePickCount(pi); };
      list.appendChild(row);
    });
    updatePickCount(pi);
  }
  function updatePickCount(pi) {
    var n = Object.keys(view.panels[pi].picked).length;
    var el = elId("qwp-pick-count-" + pi); if (el) el.textContent = n + " geselecteerd";
    var b = elId("qwp-addsel-" + pi); if (b) b.textContent = "Add selectie" + (n ? (" (" + n + ")") : "");
  }

  // ---------- Mass-add (per panel) ----------
  // vakTagId here is a live top-tag id (matches the Instellingen slot→tag map).
  function emptySlotsForVak(vakTagIdArg) {
    return view.slots.filter(function (s) {
      if (!s.isEditable || s.idCalendar === "cal_holidays") return false;
      if (s.ficheContentId || s.isGym || s.themaFiche || isThemaTitle(s.title)) return false;
      if (isNoSchool(s.dayIdx, s.time)) return false;
      var stdVak = state.settings[slotKeyStd(s.dayIdx, s.time)];
      return stdVak ? String(stdVak) === String(vakTagIdArg) : true;
    }).sort(function (a, b) { return (a.weekIdx - b.weekIdx) || (a.dayIdx - b.dayIdx) || String(a.time).localeCompare(String(b.time)); });
  }
  function allEmptySlots() {
    return view.slots.filter(function (s) { return s.isEditable && s.idCalendar !== "cal_holidays" && !s.ficheContentId && !s.isGym && !s.themaFiche && !isThemaTitle(s.title) && !isNoSchool(s.dayIdx, s.time); })
      .sort(function (a, b) { return (a.weekIdx - b.weekIdx) || (a.dayIdx - b.dayIdx) || String(a.time).localeCompare(String(b.time)); });
  }
  function slotLabel(s) { return "(wk " + (s.weekIdx + 1) + ") - " + DAY_NAMES[s.dayIdx].toLowerCase() + " - " + (s.time || ""); }

  function slotById(itemId) { return view.slots.filter(function (x) { return x.itemId === itemId; })[0] || null; }
  // Ordered pool of empty slots to auto-assign into: user-chosen targets first
  // (in click order), then Instellingen-vak matches, then chronological empties.
  function targetPool(pickTagId) {
    var seen = {}, pool = [];
    view.targetSlots.forEach(function (id) { var s = slotById(id); if (s && isTargetable(s) && !seen[id]) { seen[id] = true; pool.push(s); } });
    emptySlotsForVak(pickTagId).forEach(function (s) { if (!seen[s.itemId]) { seen[s.itemId] = true; pool.push(s); } });
    allEmptySlots().forEach(function (s) { if (!seen[s.itemId]) { seen[s.itemId] = true; pool.push(s); } });
    return pool;
  }

  function openMassAdd(pi) {
    var picks = Object.keys(view.panels[pi].picked).map(function (k) { return view.panels[pi].picked[k]; });
    if (!picks.length) { setStatus("Niets geselecteerd in paneel " + (pi + 1) + "."); return; }
    var old = elId("qwp-modal"); if (old) old.remove();
    var usingTargets = view.targetSlots.length > 0;

    var taken = {}, assign = [];
    picks.forEach(function (p) {
      var pool = targetPool(p.tagId), chosen = null;
      for (var i = 0; i < pool.length; i++) { if (!taken[pool[i].itemId]) { chosen = pool[i]; break; } }
      if (chosen) taken[chosen.itemId] = true;
      assign.push({ pick: p, slotId: chosen ? chosen.itemId : null });
    });

    var body = h("div", { class: "qwp-modal-body" });
    var addBtn;
    function slotOptions(currentId) {
      var opts = [h("option", { value: "", text: "— geen slot —", selected: (currentId ? null : "selected") })];
      allEmptySlots().forEach(function (s) {
        if (taken[s.itemId] && s.itemId !== currentId) return;
        opts.push(h("option", { value: s.itemId, text: slotLabel(s), selected: (s.itemId === currentId ? "selected" : null) }));
      });
      return opts;
    }
    // Duplicate-slot ids (two rows → same slot) for conflict highlighting.
    function dupeSlotIds() {
      var count = {}, dupes = {};
      assign.forEach(function (a) { if (a.slotId) count[a.slotId] = (count[a.slotId] || 0) + 1; });
      Object.keys(count).forEach(function (k) { if (count[k] > 1) dupes[k] = true; });
      return dupes;
    }
    function refreshState() {
      var dupes = dupeSlotIds();
      var miss = assign.filter(function (a) { return !a.slotId; }).length;
      var hasDupe = Object.keys(dupes).length > 0;
      Array.prototype.forEach.call(body.querySelectorAll(".qwp-ma-row"), function (row, idx) {
        var a = assign[idx]; if (!a) return;
        var sel = row.querySelector(".qwp-ma-slot");
        if (sel) sel.classList.toggle("dupe", !!(a.slotId && dupes[a.slotId]));
        row.classList.toggle("missing", !a.slotId);
      });
      if (addBtn) { addBtn.disabled = hasDupe; addBtn.classList.toggle("qwp-disabled", hasDupe); }
      var w = elId("qwp-ma-warn");
      if (w) w.textContent = hasDupe ? "Twee lessen wijzen naar hetzelfde lesuur (rood) — los op om te bewaren."
        : (miss ? (miss + " les(sen) hebben geen leeg lesuur gevonden.") : "");
    }
    function subjectDot(a) { var d = h("span", { class: "qwp-ma-dot" }); if (a.pick.color) d.style.background = a.pick.color; return d; }
    function rowFor(a, idx) {
      var sel = h("select", { class: "qwp-select qwp-ma-slot" }, slotOptions(a.slotId));
      sel.onchange = function () { if (a.slotId) delete taken[a.slotId]; a.slotId = sel.value ? (+sel.value) : null; if (a.slotId) taken[a.slotId] = true; refreshState(); };
      var grip = h("span", { class: "qwp-ma-grip", title: "Sleep om te herschikken", text: "⋮⋮" });
      var row = h("div", { class: "qwp-ma-row", draggable: "true", "data-idx": idx }, [
        subjectDot(a),
        h("span", { class: "qwp-ma-fiche", title: a.pick.subject || "", text: a.pick.subject || "" }),
        h("span", { class: "qwp-ma-arrow", text: "naar" }),
        sel,
        grip,
        h("button", { class: "qwp-ma-x", title: "Verwijderen", onclick: function (ev) { ev.preventDefault(); if (a.slotId) delete taken[a.slotId]; assign = assign.filter(function (x) { return x !== a; }); rebuild(); }, text: "Verwijderen" })
      ]);
      // Drag-to-swap: reorder rows, then re-assign slots chronologically by new order.
      row.ondragstart = function (e) { e.dataTransfer.setData("text/plain", "row:" + idx); row.classList.add("dragging"); };
      row.ondragover = function (e) { e.preventDefault(); };
      row.ondragend = function () { row.classList.remove("dragging"); };
      row.ondrop = function (e) {
        e.preventDefault(); var d = String(e.dataTransfer.getData("text/plain") || ""); if (d.indexOf("row:") !== 0) return;
        var from = +d.slice(4); if (from === idx) return;
        var moved = assign.splice(from, 1)[0]; assign.splice(idx, 0, moved);
        reassignChronologically(); rebuild();
      };
      return row;
    }
    // After a reorder, hand out the currently-used slots in chronological order.
    function reassignChronologically() {
      var slots = assign.map(function (a) { return a.slotId; }).filter(Boolean).map(slotById).filter(Boolean)
        .sort(function (a, b) { return (a.weekIdx - b.weekIdx) || (a.dayIdx - b.dayIdx) || String(a.time).localeCompare(String(b.time)); });
      taken = {};
      assign.forEach(function (a, i) { var s = slots[i]; a.slotId = s ? s.itemId : null; if (a.slotId) taken[a.slotId] = true; });
    }
    function rebuild() {
      body.innerHTML = "";
      body.appendChild(h("p", { class: "qwp-note", text: usingTargets ? "Gekozen doel-lesuren worden op volgorde gevuld. Sleep rijen (⋮⋮) om te herschikken." : "Elke les krijgt een leeg lesuur (voorkeur: vak uit Instellingen). Sleep rijen (⋮⋮) om te herschikken." }));
      assign.forEach(function (a, i) { body.appendChild(rowFor(a, i)); });
      body.appendChild(h("p", { class: "qwp-ma-warn", id: "qwp-ma-warn" }));
      refreshState();
    }
    rebuild();

    addBtn = h("button", {
      class: "qwp-btn qwp-approve", text: "Toevoegen aan rooster", onclick: function () {
        if (addBtn.disabled) return;
        pushUndo("selectie toevoegen");
        var snapshot = [], done = 0;
        assign.forEach(function (a) {
          if (!a.slotId) return; var s = slotById(a.slotId); if (!s) return;
          snapshot.push({ itemId: s.itemId, title: s.title, ficheContentId: s.ficheContentId, ficheTitle: s.ficheTitle, isGym: s.isGym, themaFiche: s.themaFiche, vak: s.vak });
          assignFiche(s, { id: a.pick.id, subject: a.pick.subject }); if (a.pick.tagId != null) s.vak = a.pick.tagId; done++;
        });
        view.panels[pi].picked = {}; clearTargets(); modal.remove(); renderTimetable(); renderPickList(pi); updatePickCount(pi);
        setStatus(done + " les(sen) in het rooster gezet (nog niet weggeschreven).");
        showToast(done + " les(sen) toegevoegd.", "Ongedaan maken", function () {
          snapshot.forEach(function (o) { var s = slotById(o.itemId); if (s) { s.title = o.title; s.ficheContentId = o.ficheContentId; s.ficheTitle = o.ficheTitle; s.isGym = o.isGym; s.themaFiche = o.themaFiche; s.vak = o.vak; } });
          renderTimetable(); setStatus("Toevoeging ongedaan gemaakt.");
        });
      }
    });

    var modal = h("div", { class: "qwp-modal", id: "qwp-modal" }, [
      h("div", { class: "qwp-modal-box wide qwp-ma-modal" }, [
        h("div", { class: "qwp-modal-hd", text: "Selectie toevoegen (paneel " + (pi + 1) + ") — " + picks.length + " les(sen)" + (usingTargets ? " → " + view.targetSlots.length + " doel(en)" : "") }),
        body,
        h("div", { class: "qwp-modal-ft" }, [
          h("button", { class: "qwp-btn qwp-ghost", text: "Annuleren", onclick: function () { modal.remove(); } }),
          addBtn
        ])
      ])
    ]);
    els.page.appendChild(modal);
  }

  // ---------- Toast ----------
  function showToast(msg, actionLabel, onAction) {
    var old = elId("qwp-toast"); if (old) old.remove();
    var timer = null;
    function close() { if (timer) clearTimeout(timer); var t = elId("qwp-toast"); if (t) t.remove(); }
    var toast = h("div", { class: "qwp-toast", id: "qwp-toast" }, [
      h("span", { class: "qwp-toast-msg", text: msg }),
      (actionLabel && onAction) ? h("button", { class: "qwp-toast-act", text: actionLabel, onclick: function () { onAction(); close(); } }) : null,
      h("button", { class: "qwp-toast-x", title: "Sluiten", text: "×", onclick: close })
    ]);
    els.page.appendChild(toast);
    timer = setTimeout(close, 8000);
  }

  // ---------- Undo (per-slot snapshot stack; Ctrl+Z + sidebar button) ----------
  // Only these slot fields are mutated by planning actions, so snapshot just them.
  function snapshotSlots() {
    return view.slots.map(function (s) { return { itemId: s.itemId, title: s.title, ficheContentId: s.ficheContentId, ficheTitle: s.ficheTitle, isGym: s.isGym, themaFiche: s.themaFiche, vak: s.vak }; });
  }
  function pushUndo(label) {
    view.undoStack.push({ label: label || "actie", snap: snapshotSlots() });
    if (view.undoStack.length > 30) view.undoStack.shift();
    refreshUndoBtn();
  }
  function doUndo() {
    if (!view.undoStack.length) { setStatus("Niets om ongedaan te maken."); return; }
    var entry = view.undoStack.pop();
    entry.snap.forEach(function (o) { var s = slotById(o.itemId); if (s) { s.title = o.title; s.ficheContentId = o.ficheContentId; s.ficheTitle = o.ficheTitle; s.isGym = o.isGym; s.themaFiche = o.themaFiche; s.vak = o.vak; } });
    renderTimetable(); refreshUndoBtn(); setStatus("Ongedaan: " + entry.label);
  }
  function refreshUndoBtn() {
    var b = elId("qwp-undo"); if (!b) return;
    var n = view.undoStack.length;
    b.classList.toggle("qwp-disabled", n === 0);
    b.textContent = n ? ("Ongedaan maken (" + n + ")") : "Ongedaan maken";
  }

  // ---------- Blocking commit overlay (prevents edits mid-write) ----------
  function showCommitOverlay(total) {
    hideCommitOverlay();
    var bar = h("div", { class: "qwp-progress-fill", id: "qwp-commit-bar" });
    var lbl = h("div", { class: "qwp-commit-count", id: "qwp-commit-count", text: "0 / " + total });
    var ov = h("div", { class: "qwp-commit-overlay", id: "qwp-commit-overlay" }, [
      h("div", { class: "qwp-commit-card" }, [
        h("div", { class: "qwp-spinner" }),
        h("div", { class: "qwp-commit-msg", id: "qwp-commit-msg", text: "Bezig met wegschrijven — even geduld, niet bewerken…" }),
        h("div", { class: "qwp-progress" }, [bar]),
        lbl
      ])
    ]);
    // Swallow every interaction while writing (capture phase).
    ["click", "mousedown", "keydown", "wheel", "dragstart"].forEach(function (ev) { ov.addEventListener(ev, function (e) { e.stopPropagation(); if (ev === "keydown" || ev === "dragstart") e.preventDefault(); }, true); });
    els.page.appendChild(ov);
    updateCommitOverlay(0, total);
  }
  function updateCommitOverlay(done, total) {
    var bar = elId("qwp-commit-bar"), cnt = elId("qwp-commit-count");
    var pct = total ? Math.round((done / total) * 100) : 0;
    if (bar) bar.style.width = pct + "%";
    if (cnt) cnt.textContent = done + " / " + total;
  }
  function commitOverlayResult(ok, fails) {
    var ov = elId("qwp-commit-overlay"); if (!ov) return;
    var msg = elId("qwp-commit-msg"); if (msg) { msg.textContent = ok + " weggeschreven, " + fails.length + " mislukt. Eerste fout: " + fails[0].error; msg.classList.add("err"); }
    var card = ov.querySelector(".qwp-commit-card"); var sp = ov.querySelector(".qwp-spinner"); if (sp) sp.style.display = "none";
    if (card) card.appendChild(h("button", { class: "qwp-btn", text: "Sluiten", onclick: hideCommitOverlay }));
  }
  function hideCommitOverlay() { var ov = elId("qwp-commit-overlay"); if (ov) ov.remove(); }

  // ---------- Diagnose / Zelftest (READ-ONLY — never writes, never mutates state) ----------
  var TOOL_VERSION = "qwp-2026-07-04";
  // Known-good write shapes captured from a real successful write (blueprint scrape).
  var REF_PATCH_KEYS = ["calendarId", "title", "description", "is_fullday_item", "startdate", "enddate", "starttime", "endtime", "is_published_students", "is_published_parents", "groups", "participants"];
  var REF_ATTACH_KEYS = ["schoolId", "visible_parents", "visible_students", "students", "groups", "id", "typeId"];
  function keyDiff(actual, ref) {
    var a = actual.slice().sort(), r = ref.slice().sort();
    var missing = r.filter(function (k) { return a.indexOf(k) < 0; });
    var extra = a.filter(function (k) { return r.indexOf(k) < 0; });
    return { missing: missing, extra: extra, ok: !missing.length && !extra.length };
  }
  // Read-only GET that reports transport-level facts (auth/HTML redirect).
  function diagGet(path) {
    return fetch(path, { credentials: "include", headers: { "Accept": "application/json" } }).then(function (r) {
      var ct = r.headers.get("content-type") || "";
      if (ct.indexOf("json") < 0) return { status: r.status, json: null, html: true };
      return r.json().then(function (j) { return { status: r.status, json: j, html: false }; }).catch(function () { return { status: r.status, json: null, html: false }; });
    });
  }
  function diagArr(res) { var j = res.json; var a = j && (j.result || j); return Array.isArray(a) ? a : []; }
  function has(o, k) { return o && Object.prototype.hasOwnProperty.call(o, k) && o[k] != null; }

  function openDiagnose() {
    var old = elId("qwp-modal"); if (old) old.remove();
    var list = h("div", { class: "qwp-diag-list", id: "qwp-diag-list" });
    var rows = [];
    var STAT = { OK: "OK", WARN: "WARN", FAIL: "FAIL", SKIP: "SKIP" };
    function statusPill(s) { return h("span", { class: "qwp-diag-pill " + s.toLowerCase(), text: s }); }
    function rowEl(row) {
      return h("div", { class: "qwp-diag-row" }, [
        h("div", { class: "qwp-diag-row-hd" }, [statusPill(row.status), h("span", { class: "qwp-diag-name", text: row.name })]),
        (row.expected || row.found) ? h("div", { class: "qwp-diag-detail", text: "verwacht: " + (row.expected || "—") + "  ·  gevonden: " + (row.found || "—") }) : null,
        (row.status !== STAT.OK && row.next) ? h("div", { class: "qwp-diag-next", text: "→ " + row.next }) : null
      ]);
    }
    function addRow(row) { rows.push(row); list.appendChild(rowEl(row)); list.scrollTop = list.scrollHeight; }

    var modal = h("div", { class: "qwp-modal", id: "qwp-modal" }, [
      h("div", { class: "qwp-modal-box wide qwp-diag-modal" }, [
        h("div", { class: "qwp-modal-hd", text: "Zelftest — leest alleen, schrijft nooit" }),
        h("div", { class: "qwp-modal-body" }, [
          h("p", { class: "qwp-note", text: "Controleert of de live Questi-API nog overeenkomt met wat de tool verwacht. Elke regel: OK / WARN / FAIL met een concrete volgende stap." }),
          list
        ]),
        h("div", { class: "qwp-modal-ft" }, [
          h("button", { class: "qwp-btn qwp-ghost", text: "Rapport kopiëren", onclick: function () { copyDiagReport(rows); } }),
          h("button", { class: "qwp-btn", text: "Sluiten", onclick: function () { modal.remove(); } })
        ])
      ])
    ]);
    els.page.appendChild(modal);
    runDiagnostics(addRow, STAT);
  }

  function copyDiagReport(rows) {
    var lines = ["Questi Week Planner — Zelftest", TOOL_VERSION, new Date().toString(), ""];
    rows.forEach(function (r) { lines.push("[" + r.status + "] " + r.name + (r.expected || r.found ? " — verwacht: " + (r.expected || "—") + " / gevonden: " + (r.found || "—") : "") + (r.status !== "OK" && r.next ? " — " + r.next : "")); });
    var text = lines.join("\n");
    function fallback() { var ta = document.createElement("textarea"); ta.value = text; els.page.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setStatus("Rapport gekopieerd."); }, fallback); else { fallback(); setStatus("Rapport gekopieerd."); }
  }

  // Sequentially run each check thunk, streaming its row(s) as it resolves.
  function runDiagnostics(addRow, STAT) {
    function wrap(name, group, fn) {
      return function () {
        return Promise.resolve().then(fn).then(function (row) { row.name = "[" + group + "] " + name; if (!row.status) row.status = STAT.OK; addRow(row); return row; })
          .catch(function (e) { addRow({ name: "[" + group + "] " + name, status: STAT.FAIL, found: String(e && e.message || e), next: "onverwachte fout — zie console" }); });
      };
    }
    var wr = thisWeekRange();
    var cal = ctx.calendarId ? [ctx.calendarId, "cal_holidays"] : null;
    var itemsUrl = API + "/items?" + qs({ schoolId: ctx.schoolId, startdate: wr.start, enddate: wr.end, calendars: cal || undefined });
    var shared = { authed: false, items: null, sampleItem: null, detail: null };

    var checks = [];
    // 1. Auth & connectivity
    checks.push(wrap("Sessie / verbinding", "auth", function () {
      return diagGet(API_ROOT + "/schools").then(function (res) {
        if (res.html || res.status === 401 || res.status === 403) return { status: STAT.FAIL, expected: "JSON 200 (ingelogd)", found: res.html ? "HTML/redirect" : ("HTTP " + res.status), next: "Open questi.com en log in; draai daarna opnieuw." };
        shared.authed = true;
        return { expected: "JSON 200", found: "HTTP " + res.status };
      });
    }));
    // 2. Read contract
    checks.push(wrap("/cal/items (weekitems)", "read", function () {
      if (!shared.authed) return { status: STAT.SKIP, found: "geen sessie" };
      return diagGet(itemsUrl).then(function (res) {
        var arr = diagArr(res); shared.items = arr; shared.sampleItem = arr[0] || null;
        if (!arr.length) return { status: STAT.WARN, expected: "array met items", found: "0 items in weekvenster", next: "Kies een week met lesuren." };
        var s = arr[0];
        var missing = ["id", "title", "startdate", "enddate", "id_calendar", "is_editable", "has_attachments", "groups"].filter(function (k) { return !has(s, k); });
        var hasTime = /T\d{2}:\d{2}|[ ]\d{2}:\d{2}/.test(String(s.startdate || ""));
        if (!hasTime) return { status: STAT.FAIL, expected: "startdate met tijd (T HH:MM)", found: String(s.startdate), next: "Tijd-matrix + commit starttime-fallback breken → controleer timeFromISO/startdate." };
        if (missing.length) return { status: STAT.FAIL, expected: "velden id,title,startdate,…", found: "mist: " + missing.join(","), next: "Read-mapping in hydrateRange aanpassen." };
        return { expected: "velden + tijd aanwezig", found: arr.length + " items, startdate ok" };
      });
    }));
    checks.push(wrap("/cal/items/{id} (detail)", "read", function () {
      if (!shared.authed) return { status: STAT.SKIP, found: "geen sessie" };
      var it = (shared.items || []).filter(function (x) { return x.has_attachments; })[0] || (shared.items || [])[0];
      if (!it) return { status: STAT.SKIP, found: "geen item om te testen" };
      return diagGet(API + "/items/" + it.id + "?" + qs({ schoolId: ctx.schoolId })).then(function (res) {
        var d = (res.json && res.json.result) || res.json; shared.detail = d;
        if (!d) return { status: STAT.FAIL, expected: "detail-object", found: "leeg", next: "detail-endpoint gewijzigd." };
        var att = d.attachments && d.attachments[0];
        var info = "description:" + (has(d, "description") ? "ja" : "nee") + ", attachments:" + ((d.attachments || []).length);
        if (att && !(att.content && att.content.id != null)) return { status: STAT.FAIL, expected: "attachments[0].content.id", found: "content.id ontbreekt", next: "attach-linking id-mapping controleren." };
        return { expected: "description + attachments[].content.id", found: info };
      });
    }));
    checks.push(wrap("/cal/lessons (fiches + tag-veld)", "read", function () {
      if (!shared.authed) return { status: STAT.SKIP, found: "geen sessie" };
      if (ctx.ownDefaultTagId == null) return { status: STAT.WARN, found: "ownDefaultTagId niet bepaald", next: "resolveOwnTag() — of vul handmatig in." };
      return diagGet(API + "/lessons?" + qs({ schoolId: ctx.schoolId, sorting: "new_items", status: "active", num: 1, offset: 0, default_tagId: ctx.ownDefaultTagId })).then(function (res) {
        var arr = diagArr(res), f = arr[0];
        var total = res.json && res.json.num_records;
        if (!f) return { status: STAT.WARN, expected: "≥1 fiche", found: "0 (num_records=" + total + ")", next: "Tag levert geen fiches — controleer default_tagId." };
        var cands = ["tags", "tagIds", "tag_ids", "categories"].filter(function (k) { return has(f, k); });
        var tagNote = cands.length ? ("per-fiche tagveld terug: " + cands.join(",") + " — model mogelijk gewijzigd") : "geen per-fiche tags (verwacht)";
        return { status: cands.length ? STAT.WARN : STAT.OK, expected: "id,subject; geen per-fiche tags", found: "num_records=" + total + "; " + tagNote, next: cands.length ? "Controleer ficheInVak/ficheTagIds als filtering weer client-side moet." : "" };
      });
    }));
    checks.push(wrap("/cal/lessons/tags?filter=own", "read", function () {
      if (!shared.authed) return { status: STAT.SKIP, found: "geen sessie" };
      return diagGet(API + "/lessons/tags?" + qs({ schoolId: ctx.schoolId, filter: "own" })).then(function (res) {
        var arr = diagArr(res), t = arr[0];
        if (!t) return { status: STAT.WARN, found: "0 tags", next: "Eigen tagboom leeg — pills/mapping vallen weg." };
        var missing = ["id", "title", "parent", "type", "owner"].filter(function (k) { return !has(t, k); });
        return { status: missing.length ? STAT.FAIL : STAT.OK, expected: "id,title,parent,type,owner", found: missing.length ? ("mist: " + missing.join(",")) : (arr.length + " tags"), next: missing.length ? "Tag-shape gewijzigd → topTagsForOwner/childTags." : "" };
      });
    }));
    checks.push(wrap("possible-participants", "read", function () {
      if (!shared.authed) return { status: STAT.SKIP, found: "geen sessie" };
      return diagGet(API + "/items/shares/possible-participants?" + qs({ schoolId: ctx.schoolId })).then(function (res) {
        var arr = diagArr(res), p = arr[0];
        if (!p) return { status: STAT.WARN, found: "0 personen" };
        var ok = has(p, "id") && (has(p, "firstname") || has(p, "lastname"));
        return { status: ok ? STAT.OK : STAT.FAIL, expected: "id + firstname/lastname", found: arr.length + " personen", next: ok ? "" : "fetchPeople mapping aanpassen." };
      });
    }));
    // 3. Context resolves
    checks.push(wrap("Context-ids (school/cal/group/owner)", "context", function () {
      var found = "school:" + ctx.schoolId + " cal:" + ctx.calendarId + " group:" + ctx.groupId + " owner:" + ctx.ownerId;
      var calOk = !ctx.calendarId || (shared.items || []).some(function (x) { return x.id_calendar === ctx.calendarId; });
      var grpOk = ctx.groupId == null || (shared.items || []).some(function (x) { return (x.groups || []).some(function (g) { return String(g.groupId) === String(ctx.groupId); }); });
      if (!ctx.schoolId) return { status: STAT.FAIL, found: found, next: "detectContext() — schoolId niet gevonden." };
      if (!calOk || !grpOk) return { status: STAT.WARN, expected: "cal/group in live items", found: found, next: "calendar/group id mogelijk gerold — detectContext controleren." };
      return { expected: "alle ids gedetecteerd + teruggevonden", found: found };
    }));
    checks.push(wrap("Vak → live tag mapping", "context", function () {
      // A vak may legitimately have no sub-tags — only failing to map at all is a problem.
      var miss = VAKKEN.filter(function (v) { return view.vakTagMap[v.id] == null; }).map(function (v) { return v.id; });
      if (miss.length) return { status: STAT.WARN, expected: "vakken gekoppeld aan live tags", found: "niet gekoppeld: " + miss.join(","), next: "VAKKEN.names of tagboom controleren (" + miss.join(",") + ")." };
      return { expected: "elk vak → een live top-tag", found: (VAKKEN.length - miss.length) + "/" + VAKKEN.length + " gekoppeld" };
    }));
    checks.push(wrap("Schooljaar vs. datum", "context", function () {
      var d = new Date(), y = d.getFullYear(), start = (d.getMonth() >= 7) ? y : y - 1;
      var expect = start + " - " + (start + 1);
      var sy = String(ctx.schoolyear || "");
      var ok = sy.indexOf(String(start)) > -1;
      return { status: ok ? STAT.OK : STAT.WARN, expected: "bevat " + start, found: sy || "—", next: ok ? "" : "Schooljaar waarschijnlijk gerold — herlaad/vernieuw context." };
    }));
    // 4. Write-readiness (dry — never sends)
    checks.push(wrap("PATCH-body vs. referentie", "write", function () {
      if (!shared.authed || !shared.sampleItem) return { status: STAT.SKIP, found: "geen item" };
      var it = shared.sampleItem;
      // Throwaway slot (does NOT touch view.slots); force dirty via a title tweak.
      var tmp = { itemId: it.id, title: (it.title || "") + " ", origTitle: it.title || "", startdate: it.startdate, enddate: it.enddate, idCalendar: it.id_calendar, isEditable: true, dayIdx: 0, weekIdx: 0, time: timeFromISO(it.startdate), groups: (it.groups && it.groups.length) ? it.groups : writeGroups(), isGym: false, themaFiche: false, origDescription: "", description: "", ficheContentId: null, origFicheContentId: null, ficheTitle: "", origFicheTitle: "", starttime: "", endtime: "" };
      var plan = buildCommitPlan([tmp]);
      if (!plan.length) return { status: STAT.WARN, found: "geen plan (niet dirty?)", next: "buildCommitPlan/computeDirty controleren." };
      var diff = keyDiff(Object.keys(plan[0].patchBody), REF_PATCH_KEYS);
      if (diff.ok) return { expected: REF_PATCH_KEYS.length + " sleutels", found: "identiek aan referentie" };
      return { status: STAT.FAIL, expected: REF_PATCH_KEYS.join(","), found: "mist:[" + diff.missing.join(",") + "] extra:[" + diff.extra.join(",") + "]", next: "buildCommitPlan.patchBody aanpassen aan referentie." };
    }));
    checks.push(wrap("Attachment-body vs. referentie", "write", function () {
      // Reconstruct the POST payload shape WITHOUT sending it.
      var payloadKeys = Object.keys({ schoolId: 0, visible_parents: false, visible_students: false, students: [], groups: [], id: 0, typeId: 1 });
      var diff = keyDiff(payloadKeys, REF_ATTACH_KEYS);
      return { status: diff.ok ? STAT.OK : STAT.FAIL, expected: REF_ATTACH_KEYS.join(","), found: diff.ok ? "identiek" : ("mist:[" + diff.missing.join(",") + "] extra:[" + diff.extra.join(",") + "]"), next: diff.ok ? "" : "postAttachment payload aanpassen." };
    }));
    checks.push(wrap("id-gelijkwaardigheid (content.id ↔ lesfiche)", "write", function () {
      if (!shared.authed) return { status: STAT.SKIP, found: "geen sessie" };
      var att = shared.detail && shared.detail.attachments && shared.detail.attachments[0];
      if (!att || !att.content || att.content.id == null) return { status: STAT.SKIP, found: "geen gekoppelde fiche in sample" };
      var cid = att.content.id;
      return diagGet(API + "/lessons/" + cid + "?" + qs({ schoolId: ctx.schoolId, return_format: "view" })).then(function (res) {
        var ok = res.status < 400 && res.json && (res.json.result || res.json);
        return { status: ok ? STAT.OK : STAT.WARN, expected: "content.id " + cid + " is een echte lesfiche", found: ok ? "resolvet" : ("HTTP " + res.status), next: ok ? "" : "attach-POST richt zich mogelijk op verkeerde id." };
      });
    }));
    // 5. Data sanity
    checks.push(wrap("Tellingen", "sanity", function () {
      return { expected: "fiches/tags/personen/slots", found: "tags(own):" + ownTagsList().length + " personen:" + view.people.length + " slots(week):" + view.slots.length };
    }));
    checks.push(wrap("Tijd-raster Ma–Vr", "sanity", function () {
      var perDay = [0, 1, 2, 3, 4].map(function (d) { return view.timeRows.filter(function (t) { return view.presence[d + "|" + t]; }).length; });
      return { expected: "gedeelde tijd-as", found: "rijen:" + view.timeRows.length + " · per dag: " + perDay.join("/") + (Object.keys(view.rowMeta || {}).length ? " · pauzes afgeleid" : "") };
    }));
    checks.push(wrap("Thema/gym classificatie", "sanity", function () {
      var th = [], gy = [];
      view.slots.forEach(function (s) { if (isThemaTitle(s.title) || s.themaFiche) th.push(s.title); else if (isGymTitle(s.title)) gy.push(s.title); });
      return { expected: "zichtbaar ter controle", found: "thema:" + th.length + " gym:" + gy.length + (gy.length ? " (" + gy.slice(0, 3).join(", ") + ")" : "") };
    }));

    // Run sequentially.
    checks.reduce(function (chain, thunk) { return chain.then(thunk); }, Promise.resolve());
  }

  // ---------- Instellingen ----------
  function openInstellingen() {
    var old = elId("qwp-modal"); if (old) old.remove();
    computeTimeRows();
    if (!view.timeRows.length) { setStatus("Geen rooster geladen — open eerst een week met lesuren."); return; }
    var rows = view.timeRows;
    // Vak options come from the user's LIVE top-level tag hierarchy, not a fixed list.
    var tops = panelTopTags("self");
    var grid = h("div", { class: "qwp-inst" });
    grid.appendChild(h("div", {}));
    for (var d = 0; d < 5; d++) grid.appendChild(h("div", { class: "qwp-inst-hd", text: DAY_NAMES[d].slice(0, 2).toUpperCase() }));
    grid.appendChild(h("div", { class: "qwp-inst-time", text: "thema" }));
    for (var dt = 0; dt < 5; dt++) grid.appendChild(h("div", { class: "qwp-inst-cell" }, [h("div", { class: "qwp-cell-vak", text: "WO" })]));
    rows.forEach(function (t) {
      grid.appendChild(h("div", { class: "qwp-inst-time", text: t }));
      for (var d2 = 0; d2 < 5; d2++) {
        (function (day, time) {
          if (isNoSchool(day, time)) { grid.appendChild(h("div", { class: "qwp-inst-cell qwp-inst-noschool", text: "—" })); return; }
          var key = slotKeyStd(day, time);
          var sel = h("select", {}, [h("option", { value: "", text: "—", selected: (state.settings[key] ? null : "selected") })].concat(tops.map(function (v) { return h("option", { value: v.id, text: (v.title || "").trim(), selected: (String(state.settings[key]) === String(v.id) ? "selected" : null) }); })));
          sel.onchange = function () { if (sel.value) state.settings[key] = +sel.value; else delete state.settings[key]; };
          grid.appendChild(h("div", { class: "qwp-inst-cell" }, [sel]));
        })(d2, t);
      }
    });

    var modal = h("div", { class: "qwp-modal", id: "qwp-modal" }, [
      h("div", { class: "qwp-modal-box qwp-inst-modal" }, [
        h("div", { class: "qwp-modal-hd", text: "Instellingen — vast vak per lesuur" }),
        h("div", { class: "qwp-modal-body" }, [h("p", { class: "qwp-note", text: "Dit is de standaard die elke week geldt. Ze bepaalt welk vak 'Add selectie' automatisch in een leeg lesuur plaatst." }), grid]),
        h("div", { class: "qwp-modal-ft" }, [
          h("button", { class: "qwp-btn qwp-ghost", text: "Sluiten", onclick: function () { modal.remove(); } }),
          h("button", { class: "qwp-btn qwp-approve", text: "Bewaren", onclick: function () { saveState(); modal.remove(); reloadSlotVakLabels(); renderTimetable(); setStatus("Instellingen bewaard — geldt voor elke week."); } })
        ])
      ])
    ]);
    els.page.appendChild(modal);
  }
  function reloadSlotVakLabels() { view.slots.forEach(function (s) { var v = state.settings[slotKeyStd(s.dayIdx, s.time)]; if (v && !s.ficheContentId) s.vak = v; }); }

  // ---------- Kopieer vorige week (opt-in, per-item) ----------
  // Current-week schedulable slot for a given weekday+time (first match, week 0).
  function currentSlotForDayTime(dayIdx, time) {
    return view.slots.filter(function (s) {
      if (s.idCalendar === "cal_holidays" || s.isFullday || isThemaTitle(s.title) || s.themaFiche) return false;
      return s.dayIdx === dayIdx && (s.time || (s.starttime ? String(s.starttime).slice(0, 5) : "")) === time;
    }).sort(function (a, b) { return a.weekIdx - b.weekIdx; })[0] || null;
  }
  function openCopyPrevWeek() {
    if (!view.weekStart) { setStatus("Geen week geladen."); return; }
    var old = elId("qwp-modal"); if (old) old.remove();
    var span = 7 * view.weeks;
    var prevStart = isoDate(addDays(view.weekStart, -span)), prevEnd = isoDate(addDays(view.weekStart, -1));
    setStatus("Vorige week laden…");
    hydrateRange(prevStart, prevEnd).then(function (prev) {
      var filled = prev.filter(function (s) { return s.idCalendar !== "cal_holidays" && !s.isFullday && !isThemaTitle(s.title) && (s.ficheContentId || s.isGym); })
        .sort(function (a, b) { return (a.dayIdx - b.dayIdx) || String(a.time).localeCompare(String(b.time)); });
      if (!filled.length) { setStatus("Vorige week had geen ingevulde lesuren."); return; }
      var rows = filled.map(function (ps) {
        var tgt = currentSlotForDayTime(ps.dayIdx, ps.time);
        return { ps: ps, target: tgt, chk: false };
      });
      var body = h("div", { class: "qwp-modal-body" });
      function rowVak(ps) { return ps.vak ? ((tagTitle("self", ps.vak) || "").trim()) : (ps.isGym ? "gym" : ""); }
      function render() {
        body.innerHTML = "";
        body.appendChild(h("p", { class: "qwp-note", text: "Vink aan wat je naar deze week wil overnemen. Enkel lege lesuren op hetzelfde moment worden gevuld." }));
        rows.forEach(function (r) {
          var avail = r.target && isTargetable(r.target);
          var cb = h("input", { type: "checkbox" }); cb.checked = r.chk && !!avail; cb.disabled = !avail;
          cb.onchange = function () { r.chk = cb.checked; };
          var meta = DAY_NAMES[r.ps.dayIdx].toLowerCase() + " " + (r.ps.time || "") + (rowVak(r.ps) ? " · " + rowVak(r.ps) : "");
          var status = !r.target ? "(geen lesuur deze week)" : (!avail ? "(al ingevuld)" : "");
          body.appendChild(h("label", { class: "qwp-copy-row" + (avail ? "" : " disabled") }, [
            cb,
            h("span", { class: "qwp-copy-fiche", text: r.ps.isGym ? (r.ps.title || "Gym") : (r.ps.ficheTitle || r.ps.title || "(les)") }),
            h("span", { class: "qwp-copy-meta", text: meta }),
            status ? h("span", { class: "qwp-copy-note", text: status }) : null
          ]));
        });
      }
      function setAll(fn) { rows.forEach(function (r) { var avail = r.target && isTargetable(r.target); r.chk = avail && fn(r); }); render(); }
      var modal = h("div", { class: "qwp-modal", id: "qwp-modal" }, [
        h("div", { class: "qwp-modal-box wide" }, [
          h("div", { class: "qwp-modal-hd", text: "Kopieer vorige week — " + filled.length + " ingevulde lesuren" }),
          body,
          h("div", { class: "qwp-modal-ft" }, [
            h("button", { class: "qwp-btn qwp-ghost qwp-sm", text: "Alles", onclick: function () { setAll(function () { return true; }); } }),
            h("button", { class: "qwp-btn qwp-ghost qwp-sm", text: "Enkel WO/thema", onclick: function () { setAll(function (r) { return THEMA_RE.test(r.ps.title || "") || r.ps.themaFiche; }); } }),
            h("button", { class: "qwp-btn qwp-ghost qwp-sm", text: "Wis", onclick: function () { setAll(function () { return false; }); } }),
            h("span", { class: "qwp-spacer" }),
            h("button", { class: "qwp-btn qwp-ghost", text: "Annuleren", onclick: function () { modal.remove(); } }),
            h("button", {
              class: "qwp-btn qwp-approve", text: "Kopieer selectie", onclick: function () {
                var chosen = rows.filter(function (r) { return r.chk && r.target && isTargetable(r.target); });
                if (!chosen.length) { setStatus("Niets aangevinkt."); return; }
                pushUndo("kopieer vorige week");
                chosen.forEach(function (r) {
                  if (r.ps.isGym) { r.target.isGym = true; r.target.ficheContentId = null; r.target.ficheTitle = ""; r.target.themaFiche = false; }
                  else { assignFiche(r.target, { id: r.ps.ficheContentId, subject: r.ps.ficheTitle }); }
                  if (r.ps.vak) r.target.vak = r.ps.vak;
                });
                modal.remove(); renderTimetable();
                setStatus(chosen.length + " les(sen) overgenomen uit vorige week (nog niet weggeschreven).");
              }
            })
          ])
        ])
      ]);
      els.page.appendChild(modal); render();
      setStatus("Vorige week geladen.");
    }).catch(function () { setStatus("Vorige week laden mislukt."); });
  }

  // ---------- Colleague popover ----------
  function openColleaguePopover() {
    var ex = elId("qwp-pop"); if (ex) { ex.remove(); return; }
    var selectedIds = state.colleagues.map(function (c) { return c.id; });
    var listWrap = h("div", { class: "qwp-pop-list" });
    function renderList(filter) {
      listWrap.innerHTML = "";
      view.people.filter(function (p) { return !filter || p.name.toLowerCase().indexOf(filter.toLowerCase()) > -1; }).forEach(function (p) {
        var checked = selectedIds.indexOf(p.id) > -1;
        var row = h("label", { class: "qwp-pop-row" }, [h("input", { type: "checkbox", onchange: function (e) { if (e.target.checked) { if (selectedIds.indexOf(p.id) < 0) selectedIds.push(p.id); } else selectedIds = selectedIds.filter(function (x) { return x !== p.id; }); } }), h("span", { text: p.name })]);
        if (checked) row.querySelector("input").checked = true;
        listWrap.appendChild(row);
      });
    }
    renderList("");
    var pop = h("div", { class: "qwp-pop", id: "qwp-pop" }, [
      h("div", { class: "qwp-pop-hd", text: "Kies collega's" }),
      h("input", { class: "qwp-pop-search", placeholder: "Zoek collega…", oninput: function (e) { renderList(e.target.value); } }),
      listWrap,
      h("div", { class: "qwp-pop-ft" }, [
        h("button", { class: "qwp-btn", text: "Laden", onclick: function () { state.colleagues = view.people.filter(function (p) { return selectedIds.indexOf(p.id) > -1; }).map(function (p) { return { id: p.id, name: p.name }; }); saveState(); pop.remove(); loadColleagueFiches(); } }),
        h("button", { class: "qwp-btn qwp-ghost", text: "Annuleren", onclick: function () { pop.remove(); } })
      ])
    ]);
    els.page.appendChild(pop);
  }

  // ---------- Review + commit (LOCKED until approved) ----------
  var _approvedPlan = null;
  // Per-cell diff class for the NEW grid. Precedence: red (overwrite) > green
  // (changed) > orange (still empty) > white (unchanged).
  function reviewCellClass(s) {
    if (!s) return "rv-empty";
    var overwrote = s.origFicheContentId && s.ficheContentId && String(s.origFicheContentId) !== String(s.ficheContentId);
    if (overwrote) return "rv-alert";
    if (computeDirty(s)) return "rv-changed";
    if (isTargetable(s)) return "rv-empty";
    return "rv-same";
  }
  function reviewCellContent(s, mode) {
    if (!s) return h("div", { class: "qwp-cell-empty-hint", text: "leeg" });
    var title = mode === "old" ? s.origTitle : s.title;
    var fiche;
    if (mode === "old") fiche = s.origFicheTitle || (stripHtml(s.origDescription) === "Zie themafiche." ? "Zie themafiche." : "");
    else fiche = s.isGym ? "(gym)" : ((s.themaFiche || isThemaTitle(s.title)) ? "Zie themafiche." : (s.ficheTitle || ""));
    var overwrote = mode === "new" && s.origFicheContentId && s.ficheContentId && String(s.origFicheContentId) !== String(s.ficheContentId);
    return h("div", { class: "qwp-rv-cellbody" }, [
      h("div", { class: "qwp-cell-title", text: (overwrote ? "⚠ " : "") + (title || "(leeg)") }),
      fiche ? h("div", { class: "qwp-cell-fiche qwp-rv-fiche", text: fiche }) : null
    ]);
  }
  // A read-only, full timetable grid (OLD or NEW state) for the review modal.
  // showHeaders=false skips the date-header row (the NEW grid reuses the OLD one's).
  function buildReviewGrid(mode, showHeaders) {
    computeTimeRows();
    var grid = h("div", { class: "qwp-tt qwp-rv-tt" });
    grid.style.gridTemplateColumns = "64px repeat(" + (5 * view.weeks) + ", minmax(0, 1fr))";
    if (showHeaders) {
      grid.appendChild(h("div", { class: "qwp-tt-corner" }, [h("span", { class: "qwp-tt-corner-lbl", text: "uur" })]));
      for (var wh = 0; wh < view.weeks; wh++) {
        for (var dh = 0; dh < 5; dh++) grid.appendChild(h("div", { class: "qwp-tt-dayhd" + (dh === 0 && wh > 0 ? " wk-sep" : "") }, [h("span", { class: "qwp-tt-daydate", text: fullDateLabel(wh * 7 + dh) })]));
      }
    }
    ["wo", "gd"].forEach(function (kind) {
      if (!hasThemaKind(kind)) return;
      grid.appendChild(h("div", { class: "qwp-tt-themalbl", text: kind === "gd" ? "Gods" : "WO" }));
      for (var w = 0; w < view.weeks; w++) {
        var ts = weekThemaSlot(w, kind);
        var tc = h("div", { class: "qwp-cell thema-span qwp-rv-cell" + (w > 0 ? " wk-sep" : "") }, [reviewCellContent(ts, mode)]);
        tc.style.gridColumn = "span 5"; grid.appendChild(tc);
      }
    });
    view.timeRows.forEach(function (t) {
      grid.appendChild(h("div", { class: "qwp-tt-timelbl", text: t }));
      for (var wr = 0; wr < view.weeks; wr++) {
        for (var dd = 0; dd < 5; dd++) {
          var sep = (dd === 0 && wr > 0) ? " wk-sep" : "";
          if (isNoSchool(dd, t)) { grid.appendChild(h("div", { class: "qwp-cell blank qwp-rv-cell" + sep })); continue; }
          var s = slotAt(wr, dd, t);
          var cls = "qwp-cell qwp-rv-cell" + sep + " " + (mode === "new" ? reviewCellClass(s) : "rv-old");
          grid.appendChild(h("div", { class: cls }, [reviewCellContent(s, mode)]));
        }
      }
    });
    return grid;
  }
  function openReview() {
    var plan = buildCommitPlan(view.slots);
    var old = elId("qwp-modal"); if (old) old.remove();
    if (!plan.length) { setStatus("Geen wijzigingen om te controleren."); return; }
    var body = h("div", { class: "qwp-modal-body qwp-rv-body" }, [
      h("p", { class: "qwp-note", text: "Groen = gewijzigd · oranje = nog leeg · rood ⚠ = overschrijft bestaande fiche · wit = ongewijzigd. Enkel deze occurrence." }),
      h("div", { class: "qwp-rv-section" }, [h("div", { class: "qwp-rv-caption", text: "HUIDIG (oud)" }), buildReviewGrid("old", true)]),
      h("div", { class: "qwp-rv-section" }, [h("div", { class: "qwp-rv-caption", text: "NA WEGSCHRIJVEN (nieuw)" }), buildReviewGrid("new", false)])
    ]);
    var modal = h("div", { class: "qwp-modal", id: "qwp-modal" }, [
      h("div", { class: "qwp-modal-box wide qwp-review-modal" }, [
        h("div", { class: "qwp-modal-hd", text: "Controleer wijzigingen — " + plan.length + " lesuur/lesuren" }),
        body,
        h("div", { class: "qwp-modal-ft" }, [
          h("button", { class: "qwp-btn qwp-ghost", text: "Terug", onclick: function () { modal.remove(); } }),
          h("button", {
            class: "qwp-btn qwp-approve", text: "Goedkeuren en ontgrendelen", onclick: function () {
              _approvedPlan = plan; modal.remove();
              var cb = elId("qwp-commit"); cb.removeAttribute("disabled"); cb.textContent = "Wegschrijven (" + plan.length + ")"; cb.classList.add("armed");
              setStatus("Goedgekeurd. Klik 'Wegschrijven' om live te schrijven.");
            }
          })
        ])
      ])
    ]);
    els.page.appendChild(modal);
  }
  function doCommit() {
    if (!_approvedPlan || !_approvedPlan.length) { setStatus("Niets goedgekeurd."); return; }
    var plan = _approvedPlan, i = 0, ok = 0, fails = [];
    setStatus("Bezig met wegschrijven…");
    showCommitOverlay(plan.length);
    function finish() {
      _approvedPlan = null;
      var cb = elId("qwp-commit"); cb.setAttribute("disabled", "true"); cb.textContent = "Wegschrijven (vergrendeld)"; cb.classList.remove("armed");
      if (fails.length) {
        var first = fails[0];
        setStatus(ok + " ok, " + fails.length + " fout: " + first.label + " — " + first.error + (fails.length > 1 ? " (+ " + (fails.length - 1) + " meer, zie console)" : ""));
        console.error("[QWP] commit failures:", fails);
        commitOverlayResult(ok, fails);
        reloadAndRender(); // refresh the planner for what did persist
        return;
      }
      // Full success → reload the page so Questi's own calendar reflects the writes
      // (its SPA doesn't refetch on its own). The overlay stays up during reload → no edits.
      setStatus("Klaar: " + ok + "/" + plan.length + " weggeschreven — Questi wordt vernieuwd…");
      updateCommitOverlay(plan.length, plan.length);
      var m = elId("qwp-commit-msg"); if (m) m.textContent = "Klaar — Questi wordt vernieuwd…";
      var sp = document.querySelector("#qwp-commit-overlay .qwp-spinner"); if (sp) sp.style.display = "none";
      setTimeout(function () { try { location.reload(); } catch (e) { hideCommitOverlay(); reloadAndRender(); } }, 1200);
    }
    function next() {
      if (i >= plan.length) { finish(); return; }
      var p = plan[i++];
      // Guard: never PATCH a lesuur without a real group (would 500 on id_groep null).
      if (!p.patchBody.groups || !p.patchBody.groups.length) {
        fails.push({ label: p.label, error: "geen groep gevonden — vernieuw context" });
        updateCommitOverlay(ok + fails.length, plan.length); setTimeout(next, 0); return;
      }
      // POST the fiche first (it sets the item title to Questi's decorated fiche title),
      // THEN PATCH to add description=vak — reusing that decorated title so we don't clobber
      // it with our plain one. (No-fiche rows carry attachments:[] to detach.)
      (p.fiche ? postAttachment(p.itemId, p.fiche.contentId, p.fiche.groups) : Promise.resolve(null))
        .then(function (res) { var t = res && res.result && res.result.title; if (t) p.patchBody.title = t; return patchItem(p.itemId, p.patchBody, p.range); })
        .then(function () { ok++; })
        // Continue on error — record it and keep going so one bad row can't block the rest.
        .catch(function (e) { fails.push({ label: p.label, error: String(e && e.message || e) }); })
        // Small delay between slots — sequential PATCH→POST, avoid rate-limiting (no bulk endpoint exists).
        .then(function () { var done = ok + fails.length; setStatus("Wegschrijven " + done + "/" + plan.length + "…"); updateCommitOverlay(done, plan.length); setTimeout(next, 150); });
    }
    next();
  }

  // ---------- Loading ----------
  function upsertGroup(ownerId, oname, items) { var g = groupFor(ownerId); if (g) { g.items = items; g.ownerName = oname; } else view.ficheGroups.push({ ownerId: ownerId, ownerName: oname, items: items }); _anyTagsMemo = null; }
  function loadOwnFiches() { return fetchAllFiches(myId()).then(function (r) { upsertGroup(myId(), "Ik", r.items); return r; }); }
  // Colleagues changed → refresh shared tags + drop stale per-tag cache, re-render.
  function loadColleagueFiches() {
    _sharedTagsCache = null;
    view.ficheCache = {};
    return fetchSharedTags().then(function (t) { view.sharedTags = t; renderAllPanels(); renderGlobalOwners(); setStatus("Collega's geladen: " + (state.colleagues.map(function (c) { return c.name; }).join(", ") || "geen")); });
  }
  function loadAllFiches() {
    setStatus("Alle eigen lesfiches laden…");
    return loadOwnFiches().then(function (r) {
      renderAllPanels();
      var note = elId("qwp-side-note"); if (note) note.textContent = ((r.total || (groupFor(myId()) || { items: [] }).items.length)) + " eigen lesfiches geladen.";
      setStatus("Alle eigen lesfiches geladen (" + (r.total || 0) + ").");
    }).catch(function () { setStatus("Laden van lesfiches mislukt."); });
  }

  function currentWeekRange() {
    var d = new Date(); var day = (d.getDay() + 6) % 7; var mon = new Date(d); mon.setDate(d.getDate() - day + view.weekOffset * 7);
    var end = new Date(mon); end.setDate(mon.getDate() + (7 * view.weeks - 1));
    return { start: isoDate(mon), end: isoDate(end) };
  }
  function reloadWeek() {
    var wr = currentWeekRange(); view.weekStart = wr.start;
    setStatus("Rooster laden…");
    return hydrateRange(wr.start, wr.end).then(function (slots) { view.slots = slots; reloadSlotVakLabels(); });
  }
  function reloadAndRender() { return reloadWeek().then(function () { renderTimetable(); setStatus("Rooster geladen."); }); }

  // ---------- Boot / toggle ----------
  function show() { if (els.root) els.root.classList.add("qwp-show"); document.documentElement.classList.add("qwp-locked"); }
  function hide() { if (els.root) els.root.classList.remove("qwp-show"); document.documentElement.classList.remove("qwp-locked"); var p = elId("qwp-pop"); if (p) p.remove(); }
  function toggle() { if (!els.root) { boot(); return; } var open = els.root.classList.toggle("qwp-show"); document.documentElement.classList.toggle("qwp-locked", open); }
  window.__QWP_TOGGLE = toggle;

  function reconcilePanelSources() {
    var valid = [String(myId())].concat(state.colleagues.map(function (c) { return String(c.id); }));
    [0, 1, 2].forEach(function (i) { if (valid.indexOf(String(view.panels[i].source)) < 0) { view.panels[i].source = myId(); state.panels[i].source = myId(); } });
  }
  function showContextError() {
    var wrap = elId("qwp-ttwrap"); if (wrap) {
      wrap.innerHTML = "";
      var sidInp = h("input", { class: "qwp-input", id: "qwp-manual-sid", placeholder: "bv. 1010", value: (state.manualSchoolId != null ? String(state.manualSchoolId) : (ctx.schoolId != null ? String(ctx.schoolId) : "")) });
      var syrInp = h("input", { class: "qwp-input", id: "qwp-manual-syr", placeholder: "bv. 2025-2026", value: (state.manualSchoolyear || ctx.schoolyear || "") });
      var tagInp = h("input", { class: "qwp-input", id: "qwp-manual-tag", placeholder: "bv. 5", value: (state.manualOwnTagId != null ? String(state.manualOwnTagId) : "") });
      wrap.appendChild(h("div", { class: "qwp-ctxerr" }, [
        h("div", { class: "qwp-ctxerr-t", text: "Questi-context / lesfiche-tag handmatig instellen" }),
        h("div", { class: "qwp-ctxerr-b", text: "Vul in wat niet automatisch gevonden werd. Open F12 → Netwerk → klik een /api/cal/lessons-aanvraag → in de URL staat 'schoolId=' en 'default_tagId=' (jouw eigen lesfiche-tag). Het schooljaar staat als 'schoolyear='." }),
        h("div", { class: "qwp-ctxerr-form" }, [
          h("div", { class: "qwp-field" }, [h("label", { text: "schoolId" }), sidInp]),
          h("div", { class: "qwp-field" }, [h("label", { text: "schooljaar" }), syrInp]),
          h("div", { class: "qwp-field" }, [h("label", { text: "eigen lesfiche-tag (default_tagId)" }), tagInp])
        ]),
        h("div", { class: "qwp-ctxerr-btns" }, [
          h("button", { class: "qwp-btn qwp-ghost", onclick: retryDetect, text: "Opnieuw auto-detecteren" }),
          h("button", { class: "qwp-btn", onclick: function () {
            var sid = sidInp.value.trim(); var syr = syrInp.value.trim(); var tag = tagInp.value.trim();
            if (sid && !/^\d{1,12}$/.test(sid)) { setStatus("schoolId moet een getal zijn."); return; }
            if (tag && !/^\d{1,12}$/.test(tag)) { setStatus("lesfiche-tag moet een getal zijn."); return; }
            if (sid) state.manualSchoolId = +sid;
            state.manualSchoolyear = syr || null;
            state.manualOwnTagId = tag ? +tag : null;
            saveState();
            setStatus("Handmatige instellingen bewaard — laden…");
            retryDetect();
          }, text: "Bewaren en laden" })
        ])
      ]));
    }
    setStatus("Context-detectie mislukt — vul gegevens handmatig in.");
    console.error("[QWP] context detection failed. ctx=", ctx);
  }
  // Non-destructive prompt for the per-user lesfiche tag (grid stays visible).
  function openOwnTagPrompt() {
    if (elId("qwp-modal")) return;
    var inp = h("input", { class: "qwp-input", placeholder: "bv. 5", value: (state.manualOwnTagId != null ? String(state.manualOwnTagId) : "") });
    var modal = h("div", { class: "qwp-modal", id: "qwp-modal" }, [
      h("div", { class: "qwp-modal-box" }, [
        h("div", { class: "qwp-modal-hd", text: "Eigen lesfiche-tag instellen" }),
        h("div", { class: "qwp-modal-body" }, [
          h("p", { class: "qwp-note", text: "Je eigen lesfiches konden niet automatisch geladen worden. Open F12 → Netwerk → open je lessenlijst in Questi → klik de /api/cal/lessons-aanvraag → kopieer het getal na 'default_tagId=' uit de URL." }),
          h("div", { class: "qwp-field" }, [h("label", { text: "default_tagId" }), inp])
        ]),
        h("div", { class: "qwp-modal-ft" }, [
          h("button", { class: "qwp-btn qwp-ghost", text: "Later", onclick: function () { modal.remove(); } }),
          h("button", { class: "qwp-btn", text: "Bewaren en laden", onclick: function () {
            var v = inp.value.trim(); if (!/^\d{1,12}$/.test(v)) { setStatus("lesfiche-tag moet een getal zijn."); return; }
            state.manualOwnTagId = +v; ctx.ownDefaultTagId = +v; saveState(); modal.remove();
            setStatus("Lesfiche-tag bewaard — laden…");
            loadOwnFiches().then(function () { renderAllPanels(); var note = elId("qwp-side-note"); if (note) note.textContent = (groupFor(myId()) || { items: [] }).items.length + " eigen lesfiches geladen."; });
          } })
        ])
      ])
    ]);
    els.page.appendChild(modal);
  }
  function loadEverything() {
    var sub = elId("qwp-sub"); if (sub) sub.textContent = ctx.schoolyear || "";
    reconcilePanelSources();
    // schoolId is fine but the per-user lesfiche tag wasn't found → let the user
    // paste it (grid still renders; only the fiche panels need the tag).
    if (ctx.ownDefaultTagId == null && state.manualOwnTagId == null) { openOwnTagPrompt(); }
    return Promise.all([fetchPeople(), fetchTags(), fetchOwnTags(), fetchSharedTags(), reloadWeek()]).then(function (res) {
      view.people = res[0]; view.tags = res[1]; view.ownTags = res[2]; view.sharedTags = res[3];
      view.ownTopTags = topTagsForOwner(view.ownTags, ctx.ownerId);
      buildVakTagMap();
      migrateSettingsToTagIds();
      reloadSlotVakLabels();
      renderTimetable();
      renderAllPanels(); // pills from real tags; each panel lazy-loads its tag's fiches
      renderGlobalOwners();
      return loadOwnFiches(); // full own list (for the slot popup search) via tag 5
    }).then(function () {
      var note = elId("qwp-side-note"); if (note) note.textContent = (groupFor(myId()) || { items: [] }).items.length + " eigen lesfiches geladen.";
      setStatus(state.colleagues.length ? ("Klaar. Collega's: " + state.colleagues.map(function (c) { return c.name; }).join(", ")) : "Klaar.");
      quickHealthCheck();
    });
  }
  // Cheap on-open sanity check — if anything that breaks writes/fiches is missing, make the
  // Debug button glow red (no message; user clicks Debug for details).
  function quickHealthCheck() {
    var problem = !ctx.ready || ctx.schoolId == null || ctx.groupId == null || ctx.ownDefaultTagId == null || ((groupFor(myId()) || { items: [] }).items.length === 0);
    var b = elId("qwp-debug"); if (b) b.classList.toggle("qwp-alert", !!problem);
    return problem;
  }
  function retryDetect() {
    setStatus("Opnieuw detecteren…");
    detectContext().then(function () { if (!ctx.schoolId) { showContextError(); return; } return loadEverything(); }).catch(function (e) { console.error("[QWP] retry error:", e); setStatus("Laadfout — probeer 'Vernieuwen'."); });
  }

  function boot() {
    var root = buildShell();
    document.body.appendChild(root);
    show();
    // Ctrl/⌘+Z undo — only while the panel is open and not editing text.
    document.addEventListener("keydown", function (e) {
      if (!els.root || !els.root.classList.contains("qwp-show")) return;
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || (e.key !== "z" && e.key !== "Z")) return;
      var t = e.target, tn = t && t.tagName;
      if (tn === "INPUT" || tn === "TEXTAREA" || tn === "SELECT" || (t && t.isContentEditable)) return;
      e.preventDefault(); doUndo();
    });
    // Close the global-search dropdown when clicking outside it.
    document.addEventListener("mousedown", function (e) {
      var bar = elId("qwp-globalsearch"); if (!bar) return;
      if (!bar.contains(e.target)) closeGlobalResults();
    });
    loadState().then(function () {
      view.weeks = state.weeks || 1;
      [0, 1, 2].forEach(function (i) { if (state.panels[i]) view.panels[i] = Object.assign(view.panels[i], state.panels[i]); });
      syncWeekSeg(); syncSegs(); applySplit(); wireSplitter();
      setStatus("Questi-context detecteren…");
      return detectContext();
    }).then(function () {
      if (!ctx.schoolId) { showContextError(); return; }
      return loadEverything();
    }).catch(function (e) { console.error("[QWP] boot error:", e); setStatus("Laadfout — probeer 'Vernieuwen'."); });
  }

  // Test hook (no effect in the browser).
  window.__QWP_TEST = { boot: boot, view: view, state: state, ctx: ctx, detectContext: detectContext, renderTimetable: renderTimetable, openSlotPopup: openSlotPopup, openMassAdd: openMassAdd, openInstellingen: openInstellingen };
})();
