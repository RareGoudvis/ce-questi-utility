/* Questi Week Planner — lessons.js
 * Lesfiche-manager: a separate, write-heavy module for browsing and bulk-managing
 * the teacher's own fiche library (overview · tag filter · rename/edit · mass-edit
 * tags · bulk delete). Isolated from the planner: own overlay (#qwl-overlay) + own
 * storage key. Reuses the planner's ctx + helpers via window.__QWP_SHARED.
 *
 * Layout: header(title · search · ✕) / main[ left sidebar (actions) | content(
 * top tag bar + fiche list) ].
 *
 * SAFETY: title/text/tag edits are STAGED locally and written only via the single
 * "Wijzigingen controleren" gate. Fiche edits use REPLACE semantics on tags[] (echo
 * current set) and OMIT selected_goals on the goals field, so tags/goals are never
 * silently wiped. Every edit mints a NEW fiche id — we re-read result.id after. */
(function () {
  "use strict";
  if (window.__QWP_LESSONS_LOADED) return;
  window.__QWP_LESSONS_LOADED = true;

  // ---------- Shared bridge ----------
  function S() { return window.__QWP_SHARED; }
  function ctx() { return S().ctx; }
  function api() { return S().API; }               // "/api/cal"
  function sid() { return ctx().schoolId; }
  function h() { return S().h.apply(null, arguments); }
  function qs(o) { return S().qs(o); }
  function jget(u) { return S().jget(u); }

  function allOwnTagId() { return ctx().ownDefaultTagId != null ? ctx().ownDefaultTagId : 5; }
  // Questi filters by tag with TWO params: default-bucket tags (Alle/zonder tag/samenwerk) use
  // default_tagId; a real category (type "user") uses user_tagId. default_tagId on a user tag 400s.
  function lessonsUrl(tagId, num, offset) {
    var t = ownTagById(tagId);
    var isDefault = (t && t.type === "default") || String(tagId) === String(allOwnTagId());
    var p = { schoolId: sid(), sorting: "new_items", status: "active", num: num, offset: offset };
    if (isDefault) p.default_tagId = tagId; else p.user_tagId = tagId;
    return api() + "/lessons?" + qs(p);
  }

  // ---------- Storage ----------
  var STORE_KEY = "qwp_lessons_v1";
  var lstate = { lastTagId: null, pageSize: 100, cols: 1, sortKey: null, sortDir: "asc" };
  function loadState() {
    return new Promise(function (res) {
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([STORE_KEY], function (o) { if (o && o[STORE_KEY]) Object.assign(lstate, o[STORE_KEY]); res(); });
          return;
        }
      } catch (e) { /* fall through */ }
      try { var raw = localStorage.getItem(STORE_KEY); if (raw) Object.assign(lstate, JSON.parse(raw)); } catch (e2) {}
      res();
    });
  }
  function saveState() {
    try { if (chrome && chrome.storage && chrome.storage.local) { chrome.storage.local.set({ ["" + STORE_KEY]: lstate }); return; } } catch (e) {}
    try { localStorage.setItem(STORE_KEY, JSON.stringify(lstate)); } catch (e2) {}
  }

  // ---------- Runtime state ----------
  var mgr = {
    built: false, els: {},
    ownTags: [], fiches: [], filtered: [],
    selected: {},              // ficheId -> true
    pending: {},               // ficheId -> { fiche, edit, subject?, text?{}, tags?[], createTags?[], changes[] }
    tagFilter: null, unionParent: null, expandedTop: null,
    search: "", gradeFilter: "", tagChips: {},   // ficheId -> [tagId,…]
    cols: 1, sortKey: null, sortDir: "asc",
    loading: false, tagsMapped: false, tagsMapping: false,
    importEnabled: false        // import stays gated until the OPSTAP resolver lands (August)
  };
  var GRADES = ["K0", "K1", "K2", "K3", "L1", "L2", "L3", "L4", "L5", "L6", "NLG"];

  // ---------- Write helpers ----------
  function resolveJson(kind, id, sent) {
    return function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (r.ok && !(j && j.status === "error")) return (j && j.result !== undefined) ? j.result : j;
        var msg = (j && (j.error_msg || j.message)) || ("HTTP " + r.status);
        console.error("[QWL] " + kind + " " + id + " faalde:", msg, sent ? ("| sent: " + JSON.stringify(sent)) : "");
        throw new Error(msg);
      });
    };
  }
  function readFicheEdit(id) {
    return jget(api() + "/lessons/" + id + "?" + qs({ schoolId: sid(), return_format: "edit" })).then(function (j) { return (j && j.result) || j; });
  }
  // Build a PATCH body that changes ONLY what opts specifies and preserves the rest.
  function buildPatch(ficheId, edit, opts) {
    opts = opts || {};
    var tags = opts.tags != null ? opts.tags : (edit.tags || []).map(function (t) { return t.id; });
    var fields = (edit.fields || []).map(function (f) {
      var item = { template_field_id: f.template_field_id, id: f.id };
      if (f.type === "text") {
        var has = opts.text && Object.prototype.hasOwnProperty.call(opts.text, f.template_field_id);
        item.content = has ? opts.text[f.template_field_id] : (f.content != null ? f.content : "");
      }
      return item; // goals/methods: id + template_field_id only ⇒ unchanged
    });
    return {
      lessonId: ficheId, subject: opts.subject != null ? opts.subject : edit.subject,
      schoolId: sid(), attachments: [], tags: tags, create_tags: opts.create_tags || [], fields: fields
    };
  }
  function writePatch(ficheId, body) {
    return fetch(api() + "/lessons/" + ficheId + "?return_format=short",
      { method: "PATCH", credentials: "include", headers: S().writeHeaders(), body: JSON.stringify(body) })
      .then(resolveJson("PATCH lesson", ficheId, body)); // → result (has NEW id)
  }
  // Bodyless DELETE: NO Content-Type — Questi 500s on application/json with an empty body
  // (the captured delete omits content-type). Only Accept + x-xsrf-token.
  function bodylessHeaders() { var hd = { "Accept": "application/json" }; var t = S().xsrfToken(); if (t) hd["x-xsrf-token"] = t; return hd; }
  function deleteFiches(ids) {
    return fetch(api() + "/lessons?" + qs({ schoolId: sid(), lessons: ids }),
      { method: "DELETE", credentials: "include", headers: bodylessHeaders() })
      .then(resolveJson("DELETE lessons", ids.join(","), null));
  }

  // ---------- Small data helpers ----------
  function ownTagById(id) { for (var i = 0; i < mgr.ownTags.length; i++) if (String(mgr.ownTags[i].id) === String(id)) return mgr.ownTags[i]; return null; }
  function tagName(id) { var t = ownTagById(id); return t ? (t.title || "").trim() : ("#" + id); }
  function tagHex(id) { var t = ownTagById(id); return (t && t.color) || "#c7ccd1"; }
  function ficheName(f) { return (f && f.subject) || "(zonder titel)"; }
  function gradesOf(f) { return (f && f.grades && f.grades.length) ? f.grades.join(", ") : "—"; }
  function usedOf(f) { var d = f && f.last_used_date; if (!d) return "nooit"; return String(d).slice(0, 10); }
  function selCount() { return Object.keys(mgr.selected).length; }
  function selectedIds() { return Object.keys(mgr.selected); }
  function pendCount() { return Object.keys(mgr.pending).length; }
  function fiskById(id) { for (var i = 0; i < mgr.fiches.length; i++) if (String(mgr.fiches[i].id) === String(id)) return mgr.fiches[i]; return null; }

  function runSequential(items, fn, onProgress) {
    var i = 0, fails = [];
    return new Promise(function (resolve) {
      function next() {
        if (i >= items.length) { resolve(fails); return; }
        var it = items[i], idx = i; i++;
        Promise.resolve().then(function () { return fn(it, idx); })
          .catch(function (e) { fails.push({ item: it, error: (e && e.message) || String(e) }); })
          .then(function () { if (onProgress) onProgress(idx + 1, items.length); setTimeout(next, 150); });
      }
      next();
    });
  }

  // ========================================================================
  //  Overlay shell
  // ========================================================================
  function build() {
    if (mgr.built) return;
    var search = h("input", { class: "qwl-search", id: "qwl-search", type: "text", placeholder: "Zoek in titels…", oninput: function (e) { mgr.search = e.target.value || ""; applyFilter(); } });
    var gradeSel = h("select", { class: "qwl-gradesel", id: "qwl-gradesel", onchange: function (e) { mgr.gradeFilter = e.target.value || ""; applyFilter(); } },
      [h("option", { value: "", text: "Alle leerjaren" })].concat(GRADES.map(function (g) { return h("option", { value: g, text: g }); })));
    var header = h("div", { class: "qwl-header" }, [
      h("div", { class: "qwl-title", text: "Lesfiches beheren" }),
      search, gradeSel,
      h("span", { class: "qwl-status", id: "qwl-status", text: "" }),
      h("span", { class: "qwl-hspacer" }),
      h("button", { class: "qwl-x", onclick: close, title: "Sluiten", text: "✕" })
    ]);
    var side = h("div", { class: "qwl-side", id: "qwl-side" }, [
      h("div", { class: "qwl-side-lbl", text: "Selectie" }),
      h("button", { class: "qwl-sbtn", id: "qwl-selall", onclick: toggleSelectAll, text: "Alles selecteren" }),
      h("button", { class: "qwl-sbtn", id: "qwl-tags", onclick: openTagsModal, text: "Tags bewerken" }),
      h("button", { class: "qwl-sbtn qwl-danger", id: "qwl-del", onclick: openDeleteModal, text: "Verwijderen" }),
      h("div", { class: "qwl-side-sep" }),
      h("div", { class: "qwl-side-lbl", text: "Weergave" }),
      h("button", { class: "qwl-sbtn", id: "qwl-cols", onclick: toggleCols, text: "" }),
      h("button", { class: "qwl-sbtn", onclick: reload, text: "Vernieuwen" }),
      h("button", { class: "qwl-sbtn qwl-import", id: "qwl-import", onclick: function () { if (mgr.importEnabled) openImportView(); }, title: "Binnenkort — OPSTAP volgt", disabled: mgr.importEnabled ? null : "true", text: "Importeren" }),
      h("div", { class: "qwl-side-grow" }),
      h("button", { class: "qwl-sbtn qwl-review", id: "qwl-review", onclick: openReviewEdits, text: "Wijzigingen controleren" }),
      h("button", { class: "qwl-sbtn qwl-muted", onclick: openDiag, title: "Zelftest — leest alleen", text: "Diagnose" })
    ]);
    var tagbar = h("div", { class: "qwl-tagbar", id: "qwl-tagbar" });
    var listWrap = h("div", { class: "qwl-listwrap", id: "qwl-listwrap" });
    var content = h("div", { class: "qwl-content" }, [tagbar, h("div", { class: "qwl-count", id: "qwl-count", text: "" }), listWrap]);
    var main = h("div", { class: "qwl-main" }, [side, content]);
    var page = h("div", { class: "qwl-page" }, [header, main]);
    var overlay = h("div", { class: "qwl-overlay", id: "qwl-overlay" }, [page]);
    document.body.appendChild(overlay);
    mgr.els = { root: overlay, page: page, tagbar: tagbar, list: listWrap };
    mgr.built = true;
  }
  function setStatus(t) { var s = document.getElementById("qwl-status"); if (s) s.textContent = t || ""; }
  function show() { mgr.els.root.classList.add("qwl-show"); document.documentElement.classList.add("qwl-locked"); }

  function open() {
    if (!window.__QWP_SHARED) { console.warn("[QWL] __QWP_SHARED ontbreekt — planner niet geladen."); return; }
    build(); show();
    loadState().then(function () {
      mgr.cols = lstate.cols || 1; mgr.sortKey = lstate.sortKey || null; mgr.sortDir = lstate.sortDir || "asc";
      if (mgr.ownTags.length) { renderTagBar(); applyFilter(); loadAllTagMemberships(); return; }
      setStatus("Tags laden…");
      return S().fetchOwnTags().then(function (tags) {
        mgr.ownTags = tags || [];
        renderTagBar();
        var startTag = lstate.lastTagId != null ? lstate.lastTagId : allOwnTagId();
        return loadList(startTag).then(function () { loadAllTagMemberships(); });
      });
    });
  }
  function close() {
    if (mgr.els.root) mgr.els.root.classList.remove("qwl-show");
    var planner = document.getElementById("qwp-overlay");
    if (!(planner && planner.classList.contains("qwp-show"))) document.documentElement.classList.remove("qwl-locked");
  }
  function reload() { loadList(mgr.tagFilter != null ? mgr.tagFilter : allOwnTagId()); }
  function toggleCols() { mgr.cols = (mgr.cols === 2 ? 1 : 2); lstate.cols = mgr.cols; saveState(); renderList(); }

  // ========================================================================
  //  Top tag bar (tops + subtags of the expanded/active top)
  // ========================================================================
  function chipEl(label, color, active, onclick, num) {
    return h("button", { class: "qwl-tagchip" + (active ? " active" : ""), onclick: onclick }, [
      color ? h("span", { class: "qwl-dot", style: "background:" + color }) : null,
      h("span", { text: label }),
      (typeof num === "number" && num > 0) ? h("span", { class: "qwl-tagnum", text: String(num) }) : null
    ]);
  }
  function isSubjectTop(t) { return !(t.type === "default" || /alle.*lesfiches/i.test(t.title || "")); }
  function renderTagBar() {
    var bar = mgr.els.tagbar; if (!bar) return; bar.innerHTML = "";
    var tops = S().topTagsForOwner(mgr.ownTags, ctx().ownerId);
    var row1 = h("div", { class: "qwl-tagrow" });
    tops.forEach(function (t) {
      var subj = isSubjectTop(t);
      var active = String(mgr.tagFilter) === String(t.id);
      // No count on chips: Questi's per-tag number_of_lessons is a stale server cache (counts
      // deleted fiches). The accurate "N fiches" line below the search is the source of truth.
      row1.appendChild(chipEl((t.title || "").trim(), (t.color || "#c7ccd1"), active,
        subj ? function () { loadListUnion(t.id); } : function () { mgr.expandedTop = null; loadList(t.id); }));
    });
    // "Zonder tag" (default tag id 1) — untagged / old-year triage.
    var zt = ownTagById(1) || { id: 1, title: "Zonder tag", color: "#c7ccd1" };
    row1.appendChild(chipEl((zt.title || "Zonder tag").trim(), "#c7ccd1", String(mgr.tagFilter) === "1", function () { mgr.expandedTop = null; loadList(1); }));
    bar.appendChild(row1);
    // Subtag row for the expanded subject: "Alle [vak]" union chip + each subtag.
    if (mgr.expandedTop != null) {
      var parent = ownTagById(mgr.expandedTop);
      var kids = mgr.ownTags.filter(function (k) { return String(k.parent) === String(mgr.expandedTop); })
        .sort(function (a, b) { return (a.title || "").localeCompare((b.title || ""), undefined, { numeric: true }); });
      if (parent) {
        var row2 = h("div", { class: "qwl-tagrow qwl-subrow" });
        row2.appendChild(chipEl("Alle " + (parent.title || "").trim(), (parent.color || "#c7ccd1"), String(mgr.unionParent) === String(parent.id), function () { loadListUnion(parent.id); }));
        kids.forEach(function (k) {
          row2.appendChild(chipEl((k.title || "").trim(), (k.color || "#c7ccd1"), (String(mgr.tagFilter) === String(k.id) && mgr.unionParent == null), function () { loadList(k.id); }));
        });
        bar.appendChild(row2);
      }
    }
  }

  // ========================================================================
  //  Fiche list
  // ========================================================================
  // Page through one tag → full fiche objects; learns per-fiche tag membership (chips).
  function fetchTagFiches(tagId) {
    var acc = [], PAGE = lstate.pageSize || 100, MAXP = 60;
    function page(offset, guard) {
      return jget(lessonsUrl(tagId, PAGE, offset)).then(function (j) {
        var res = (j && j.result) || [], total = (j && j.num_records) != null ? j.num_records : acc.length + res.length;
        acc = acc.concat(res);
        if (res.length === PAGE && acc.length < total && guard < MAXP) return page(offset + PAGE, guard + 1);
        return acc;
      });
    }
    return page(0, 0).then(function (all) {
      if (String(tagId) !== String(allOwnTagId())) all.forEach(function (f) { var l = mgr.tagChips[f.id] || (mgr.tagChips[f.id] = []); if (l.indexOf(tagId) < 0) l.push(tagId); });
      return all;
    });
  }
  function childIdsOf(parentId) { return mgr.ownTags.filter(function (k) { return String(k.parent) === String(parentId); }).map(function (k) { return k.id; }); }

  function loadList(tagId) {
    mgr.loading = true; mgr.tagFilter = tagId; mgr.unionParent = null; lstate.lastTagId = tagId; saveState();
    renderTagBar(); renderList(); setStatus("Lesfiches laden…");
    return fetchTagFiches(tagId).then(function (all) {
      mgr.fiches = all; mgr.loading = false; setStatus(""); applyFilter();
    }).catch(function (e) { mgr.loading = false; setStatus("Laadfout: " + ((e && e.message) || e)); });
  }
  // "Alle [vak]" = union of the parent subject tag + all its child tags (a bare parent fetch
  // misses fiches tagged only under a child). Merge full fiche objects, dedupe by id.
  function loadListUnion(parentId) {
    mgr.loading = true; mgr.tagFilter = parentId; mgr.unionParent = parentId; mgr.expandedTop = parentId;
    lstate.lastTagId = parentId; saveState();
    renderTagBar(); renderList(); setStatus("Lesfiches laden…");
    var ids = [parentId].concat(childIdsOf(parentId));
    return Promise.all(ids.map(fetchTagFiches)).then(function (lists) {
      var seen = {}, merged = [];
      lists.forEach(function (arr) { (arr || []).forEach(function (f) { if (f && !seen[f.id]) { seen[f.id] = true; merged.push(f); } }); });
      mgr.fiches = merged; mgr.loading = false; setStatus(""); applyFilter();
    }).catch(function (e) { mgr.loading = false; setStatus("Laadfout: " + ((e && e.message) || e)); });
  }

  function fetchTagFicheIds(tagId) {
    var acc = [], PAGE = 100, MAXP = 60;
    function page(offset, guard) {
      return jget(lessonsUrl(tagId, PAGE, offset)).then(function (j) {
        var res = (j && j.result) || [], total = (j && j.num_records) != null ? j.num_records : acc.length + res.length;
        res.forEach(function (f) { acc.push(f.id); });
        if (res.length === PAGE && acc.length < total && guard < MAXP) return page(offset + PAGE, guard + 1);
        return acc;
      });
    }
    return page(0, 0);
  }
  // Walk every real own tag (tops + children) once → fill mgr.tagChips so the Tags column
  // populates without per-fiche reads. Runs on every open (guarded against concurrent runs).
  function loadAllTagMemberships() {
    if (mgr.tagsMapped || mgr.tagsMapping) return;
    mgr.tagsMapping = true;
    var tags = mgr.ownTags.filter(function (t) { return t.type !== "default"; });
    var i = 0, total = tags.length;
    if (!total) { mgr.tagsMapping = false; return; }
    function nextTag() {
      if (i >= tags.length) { mgr.tagsMapping = false; mgr.tagsMapped = true; scheduleRender(); return; }
      var t = tags[i++];
      fetchTagFicheIds(t.id).then(function (ids) {
        ids.forEach(function (fid) { var l = mgr.tagChips[fid] || (mgr.tagChips[fid] = []); if (l.indexOf(t.id) < 0) l.push(t.id); });
      }).catch(function () {}).then(function () { scheduleRender(); setTimeout(nextTag, 40); });
    }
    nextTag();
  }
  var _renderTimer = null;
  function scheduleRender() { if (_renderTimer) return; _renderTimer = setTimeout(function () { _renderTimer = null; renderList(); }, 400); }

  var SORTERS = {
    subject: function (a, b) { return ficheName(a).localeCompare(ficheName(b), undefined, { numeric: true }); },
    grades: function (a, b) { return gradesOf(a).localeCompare(gradesOf(b), undefined, { numeric: true }); },
    used: function (a, b) { return String(a.last_used_date || "").localeCompare(String(b.last_used_date || "")); },
    tags: function (a, b) { return (mgr.tagChips[a.id] || []).length - (mgr.tagChips[b.id] || []).length; }
  };
  function applyFilter() {
    var q = (mgr.search || "").trim().toLowerCase(), g = mgr.gradeFilter || "";
    mgr.filtered = mgr.fiches.filter(function (f) {
      if (q && ficheName(f).toLowerCase().indexOf(q) === -1) return false;
      if (g && (!f.grades || f.grades.indexOf(g) === -1)) return false;
      return true;
    });
    if (mgr.sortKey && SORTERS[mgr.sortKey]) { mgr.filtered.sort(SORTERS[mgr.sortKey]); if (mgr.sortDir === "desc") mgr.filtered.reverse(); }
    renderList();
  }
  function sortBy(key) {
    if (mgr.sortKey === key) mgr.sortDir = (mgr.sortDir === "asc" ? "desc" : "asc");
    else { mgr.sortKey = key; mgr.sortDir = "asc"; }
    lstate.sortKey = mgr.sortKey; lstate.sortDir = mgr.sortDir; saveState();
    applyFilter();
  }
  function sortArrow(key) { return mgr.sortKey === key ? (mgr.sortDir === "asc" ? " ▲" : " ▼") : ""; }

  function headCell(cls, key, label) {
    return h("div", { class: cls + " qwl-sortable", onclick: function () { sortBy(key); }, text: label + sortArrow(key) });
  }
  function ficheRow(f) {
    var checked = !!mgr.selected[f.id], pending = !!mgr.pending[f.id];
    var chips = (mgr.tagChips[f.id] || []).map(function (tid) {
      return h("span", { class: "qwl-chip", style: "border-color:" + tagHex(tid) }, [h("span", { class: "qwl-dot", style: "background:" + tagHex(tid) }), h("span", { text: tagName(tid) })]);
    });
    var cb = h("input", { class: "qwl-cb", type: "checkbox" }); cb.checked = checked;
    cb.addEventListener("change", function () { if (cb.checked) mgr.selected[f.id] = true; else delete mgr.selected[f.id]; updateSidebar(); });
    var curTitle = (pending && mgr.pending[f.id].subject != null) ? mgr.pending[f.id].subject : ficheName(f);
    var subjectCell = h("div", { class: "qwl-c-subject" });
    var txt = h("span", { class: "qwl-c-subject-txt", text: curTitle, title: "Klik om de titel te bewerken" });
    txt.addEventListener("click", function (e) { e.stopPropagation(); startInlineTitle(f, subjectCell, ficheName(f)); });
    subjectCell.appendChild(txt);
    if (pending) subjectCell.appendChild(h("span", { class: "qwl-badge", text: "gewijzigd" }));
    var row = h("div", { class: "qwl-row" + (checked ? " sel" : "") + (pending ? " pend" : ""), title: "Dubbelklik om volledig te bewerken" }, [
      h("label", { class: "qwl-cbcell" }, [cb]),
      subjectCell,
      h("div", { class: "qwl-c-grades", text: gradesOf(f) }),
      h("div", { class: "qwl-c-used", text: usedOf(f) }),
      h("div", { class: "qwl-c-tags" }, chips)
    ]);
    row.addEventListener("dblclick", function () { openEditModal(f); });
    return row;
  }
  // Inline title edit: swap the title text for an input; Enter/blur stages a title-only change.
  function startInlineTitle(f, cell, origTitle) {
    cell.innerHTML = "";
    var inp = h("input", { class: "qwl-titleinput", type: "text", value: (mgr.pending[f.id] && mgr.pending[f.id].subject != null) ? mgr.pending[f.id].subject : origTitle });
    cell.appendChild(inp); inp.focus(); inp.select();
    var done = false;
    function commit() {
      if (done) return; done = true;
      var nv = inp.value;
      if (nv !== origTitle) stagePending(f, null, { subject: nv }, [{ label: "Titel", old: origTitle, nw: nv }]);
      renderList();
    }
    inp.addEventListener("click", function (e) { e.stopPropagation(); });
    inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") inp.blur(); else if (e.key === "Escape") { done = true; renderList(); } });
    inp.addEventListener("blur", commit);
  }
  function makeTable(items) {
    var table = h("div", { class: "qwl-table" });
    table.appendChild(h("div", { class: "qwl-row qwl-thead" }, [
      h("div", { class: "qwl-cbcell" }),
      headCell("qwl-c-subject", "subject", "Titel"),
      headCell("qwl-c-grades", "grades", "Leerjaar"),
      headCell("qwl-c-used", "used", "Laatst gebruikt"),
      headCell("qwl-c-tags", "tags", "Tags")
    ]));
    items.forEach(function (f) { table.appendChild(ficheRow(f)); });
    return table;
  }
  function renderList() {
    var wrap = mgr.els.list; if (!wrap) return; wrap.innerHTML = "";
    updateSidebar();
    if (mgr.loading) { wrap.appendChild(h("div", { class: "qwl-empty", text: "Laden…" })); return; }
    if (!mgr.filtered.length) { wrap.appendChild(h("div", { class: "qwl-empty", text: "Geen lesfiches." })); return; }
    if (mgr.cols === 2) {
      var mid = Math.ceil(mgr.filtered.length / 2);
      wrap.appendChild(h("div", { class: "qwl-cols" }, [makeTable(mgr.filtered.slice(0, mid)), makeTable(mgr.filtered.slice(mid))]));
    } else {
      wrap.appendChild(makeTable(mgr.filtered));
    }
  }

  function updateSidebar() {
    var n = selCount(), p = pendCount();
    var c = document.getElementById("qwl-count"); if (c) c.textContent = mgr.filtered.length + " fiches" + (n ? " · " + n + " geselecteerd" : "");
    var tg = document.getElementById("qwl-tags"), dl = document.getElementById("qwl-del"), sa = document.getElementById("qwl-selall"), rv = document.getElementById("qwl-review"), cols = document.getElementById("qwl-cols");
    if (tg) { tg.textContent = "Tags bewerken" + (n ? " (" + n + ")" : ""); tg.disabled = n ? null : "true"; }
    if (dl) { dl.textContent = "Verwijderen" + (n ? " (" + n + ")" : ""); dl.disabled = n ? null : "true"; }
    if (sa) sa.textContent = (n && n >= mgr.filtered.length && mgr.filtered.length) ? "Wis selectie" : "Alles selecteren";
    if (rv) { rv.textContent = "Wijzigingen controleren" + (p ? " (" + p + ")" : ""); rv.style.display = p ? "" : "none"; }
    if (cols) cols.textContent = mgr.cols === 2 ? "1 kolom" : "2 kolommen";
  }
  function toggleSelectAll() {
    var allSel = selCount() >= mgr.filtered.length && mgr.filtered.length;
    if (allSel) mgr.selected = {}; else mgr.filtered.forEach(function (f) { mgr.selected[f.id] = true; });
    renderList();
  }

  // ========================================================================
  //  Modal plumbing
  // ========================================================================
  function modal(titleText, bodyEls, footerEls, cls) {
    var box = h("div", { class: "qwl-modal-box" + (cls ? " " + cls : "") }, [
      h("div", { class: "qwl-modal-hd" }, [h("span", { text: titleText })]),
      h("div", { class: "qwl-modal-bd" }, bodyEls),
      h("div", { class: "qwl-modal-ft" }, footerEls)
    ]);
    var back = h("div", { class: "qwl-modal" }, [box]);
    mgr.els.page.appendChild(back);
    back.close = function () { back.remove(); };
    return back;
  }

  // ------------------------------------------------------------------------
  //  Edit one fiche (title + text) — STAGES into pending, never writes here
  // ------------------------------------------------------------------------
  function openEditModal(f) {
    var m = modal("Bewerk: " + ficheName(f), [h("div", { class: "qwl-loading", text: "Fiche laden…" })], [], "wide");
    readFicheEdit(f.id).then(function (edit) {
      var pend = mgr.pending[f.id];
      var subjInp = h("input", { class: "qwl-input", type: "text", value: (pend && pend.subject != null ? pend.subject : (edit.subject || "")) });
      var textFields = (edit.fields || []).filter(function (x) { return x.type === "text"; });
      var areas = {};
      var body = [h("label", { class: "qwl-flabel", text: "Titel" }), subjInp];
      textFields.forEach(function (fld) {
        body.push(h("label", { class: "qwl-flabel", text: (fld.title || "Tekst") }));
        var ta = h("textarea", { class: "qwl-textarea", rows: "4" });
        ta.value = (pend && pend.text && Object.prototype.hasOwnProperty.call(pend.text, fld.template_field_id)) ? pend.text[fld.template_field_id] : (fld.content != null ? fld.content : "");
        areas[fld.template_field_id] = ta; body.push(ta);
      });
      if ((edit.fields || []).some(function (x) { return x.type === "goals"; })) body.push(h("div", { class: "qwl-note", text: "ZILL-doelen blijven ongewijzigd." }));
      body.push(h("div", { class: "qwl-note", text: "Niets wordt geschreven tot je op 'Wijzigingen controleren' klikt en goedkeurt." }));
      var bd = m.querySelector(".qwl-modal-bd"); bd.innerHTML = ""; body.forEach(function (e) { bd.appendChild(e); });
      var ft = m.querySelector(".qwl-modal-ft"); ft.innerHTML = "";
      ft.appendChild(h("button", { class: "qwl-btn qwl-ghost", onclick: m.close, text: "Annuleer" }));
      if (mgr.pending[f.id]) ft.appendChild(h("button", { class: "qwl-btn qwl-ghost", onclick: function () { delete mgr.pending[f.id]; m.close(); renderList(); setStatus("Wijziging verworpen."); }, text: "Verwerpen" }));
      ft.appendChild(h("button", { class: "qwl-btn", onclick: function () {
        var subject = subjInp.value, text = {}, changes = [];
        if ((subject || "") !== (edit.subject || "")) changes.push({ label: "Titel", old: edit.subject || "", nw: subject || "" });
        textFields.forEach(function (fld) {
          var nv = areas[fld.template_field_id].value, ov = fld.content != null ? fld.content : "";
          text[fld.template_field_id] = nv;
          if (nv !== ov) changes.push({ label: fld.title || "Tekst", old: ov, nw: nv });
        });
        stagePending(f, edit, { subject: subject, text: text }, changes);
        m.close(); renderList();
        setStatus(pendCount() + " wijziging(en) klaargezet — druk 'Wijzigingen controleren'.");
      }, text: "Bewaar wijziging" }));
    }).catch(function (e) {
      var bd = m.querySelector(".qwl-modal-bd"); bd.innerHTML = ""; bd.appendChild(h("div", { class: "qwl-note", text: "Laadfout: " + ((e && e.message) || e) }));
    });
  }
  // Merge a staged change into pending[id] (title/text and/or tags/createTags). `edit` may be
  // null (inline title edit) — writePending reads the edit snapshot lazily before writing.
  function stagePending(f, edit, opts, changes) {
    var e = mgr.pending[f.id] || { fiche: f, edit: null, changes: [] };
    e.fiche = f; if (edit) e.edit = edit;
    if (opts.subject !== undefined) e.subject = opts.subject;
    if (opts.text !== undefined) e.text = opts.text;
    if (opts.tags !== undefined) e.tags = opts.tags;
    if (opts.create_tags !== undefined) e.createTags = opts.create_tags;
    e.changes = (e.changes || []).filter(function (c) { return changes.every(function (n) { return n.label !== c.label; }); }).concat(changes);
    var origSubject = (e.edit && e.edit.subject != null) ? e.edit.subject : ficheName(f);
    var textChanged = e.text && e.edit && Object.keys(e.text).some(function (k) { var fld = (e.edit.fields || []).filter(function (x) { return x.template_field_id === k; })[0]; return fld && (e.text[k] !== (fld.content != null ? fld.content : "")); });
    var meaningful = (e.subject != null && e.subject !== origSubject) || (e.tags != null) || (e.createTags && e.createTags.length) || textChanged;
    if (meaningful) mgr.pending[f.id] = e; else delete mgr.pending[f.id];
  }

  // Review ALL staged edits → approve → sequential write.
  function openReviewEdits() {
    var keys = Object.keys(mgr.pending); if (!keys.length) return;
    var body = [h("div", { class: "qwl-note", text: keys.length + " fiche(s) gewijzigd. Doelen en niet-gewijzigde tags blijven behouden; elke fiche krijgt een nieuw versie-id." })];
    keys.forEach(function (id) {
      var p = mgr.pending[id];
      body.push(h("div", { class: "qwl-review-head", text: ficheName(p.fiche) }));
      (p.changes || []).forEach(function (c) {
        body.push(h("div", { class: "qwl-diff" }, [
          h("div", { class: "qwl-diff-lbl", text: c.label }),
          h("div", { class: "qwl-diff-old" }, [c.oldEl || h("span", { text: (c.old || "—").slice(0, 240) })]),
          h("div", { class: "qwl-diff-new" }, [c.newEl || h("span", { text: (c.nw || "—").slice(0, 240) })])
        ]));
      });
    });
    var m = modal("Wijzigingen controleren — " + keys.length + " fiches", body, [], "wide");
    var ft = m.querySelector(".qwl-modal-ft");
    ft.appendChild(h("button", { class: "qwl-btn qwl-ghost", onclick: m.close, text: "Terug" }));
    ft.appendChild(h("button", { class: "qwl-btn qwl-ghost qwl-danger", onclick: function () { mgr.pending = {}; m.close(); renderList(); setStatus("Alle wijzigingen verworpen."); }, text: "Alles verwerpen" }));
    ft.appendChild(h("button", { class: "qwl-btn", onclick: function () { m.close(); writePending(keys.slice()); }, text: "Wegschrijven (" + keys.length + ")" }));
  }
  function writePending(keys) {
    var prog = progressModal("Wijzigingen wegschrijven");
    runSequential(keys, function (id) {
      var p = mgr.pending[id]; if (!p) return Promise.resolve();
      var opts = {}; if (p.subject != null) opts.subject = p.subject; if (p.text) opts.text = p.text; if (p.tags != null) opts.tags = p.tags; if (p.createTags && p.createTags.length) opts.create_tags = p.createTags;
      // Inline title edits carry no edit snapshot — fetch it now (for field ids + current tags).
      var editP = p.edit ? Promise.resolve(p.edit) : readFicheEdit(p.fiche.id);
      return editP.then(function (edit) { p.edit = edit; return writePatch(p.fiche.id, buildPatch(p.fiche.id, edit, opts)); }).then(function (result) {
        var newId = result && result.id != null ? result.id : p.fiche.id, oldId = p.fiche.id;
        p.fiche.id = newId; if (result && result.subject != null) p.fiche.subject = result.subject;
        if (p.tags != null) mgr.tagChips[newId] = p.tags.map(function (x) { return x; });
        else if (mgr.tagChips[oldId]) mgr.tagChips[newId] = mgr.tagChips[oldId];
        if (oldId !== newId) delete mgr.tagChips[oldId];
        if (mgr.selected[oldId]) { delete mgr.selected[oldId]; mgr.selected[newId] = true; }
        delete mgr.pending[id];
      });
    }, prog.update).then(function (fails) { prog.done(fails, keys.length); renderList(); });
  }

  // ------------------------------------------------------------------------
  //  Mass-edit tags — tri-state picker + create-tag → STAGES into pending
  // ------------------------------------------------------------------------
  function chipRow(list) { return h("div", { class: "qwl-c-tags" }, list.map(function (tid) { return h("span", { class: "qwl-chip", style: "border-color:" + tagHex(tid) }, [h("span", { class: "qwl-dot", style: "background:" + tagHex(tid) }), h("span", { text: tagName(tid) })]); })); }
  function openTagsModal() {
    var ids = selectedIds(); if (!ids.length) return;
    var addSet = {}, remSet = {};
    var newTagInp = h("input", { class: "qwl-input", type: "text", placeholder: "naam van nieuwe tag (optioneel)" });
    var pickWrap = h("div", { class: "qwl-tagpick" });
    function pill(tg) {
      var st = addSet[tg.id] ? "add" : (remSet[tg.id] ? "rem" : "");
      return h("button", { class: "qwl-pill " + st, onclick: function () {
        if (addSet[tg.id]) { delete addSet[tg.id]; remSet[tg.id] = true; }
        else if (remSet[tg.id]) { delete remSet[tg.id]; }
        else { addSet[tg.id] = true; }
        renderPick();
      } }, [h("span", { class: "qwl-dot", style: "background:" + (tg.color || "#c7ccd1") }), h("span", { text: (tg.title || "").trim() }), h("span", { class: "qwl-pill-mark", text: addSet[tg.id] ? "＋" : (remSet[tg.id] ? "－" : "") })]);
    }
    function renderPick() {
      pickWrap.innerHTML = "";
      var tops = S().topTagsForOwner(mgr.ownTags, ctx().ownerId).filter(function (t) { return !/alle.*lesfiches/i.test(t.title || ""); });
      tops.forEach(function (t) {
        var kids = mgr.ownTags.filter(function (k) { return String(k.parent) === String(t.id); }).sort(function (a, b) { return (a.title || "").localeCompare((b.title || ""), undefined, { numeric: true }); });
        var grp = h("div", { class: "qwl-pickgrp" }, [h("div", { class: "qwl-pickgrp-top" }, [pill(t)])]);
        if (kids.length) grp.appendChild(h("div", { class: "qwl-pickgrp-kids" }, kids.map(pill)));
        pickWrap.appendChild(grp);
      });
    }
    renderPick();
    var m = modal("Tags bewerken — " + ids.length + " fiches", [
      h("div", { class: "qwl-note", text: "Klik een tag: 1× toevoegen (＋), 2× verwijderen (－), 3× niets. Wijzigingen worden klaargezet; niets wordt geschreven tot 'Wijzigingen controleren'." }),
      pickWrap,
      h("label", { class: "qwl-flabel", text: "Nieuwe tag maken + toevoegen" }), newTagInp
    ], [], "wide");
    var ft = m.querySelector(".qwl-modal-ft");
    ft.appendChild(h("button", { class: "qwl-btn qwl-ghost", onclick: m.close, text: "Annuleer" }));
    ft.appendChild(h("button", { class: "qwl-btn", onclick: function () {
      var add = Object.keys(addSet), rem = Object.keys(remSet), newName = (newTagInp.value || "").trim();
      if (!add.length && !rem.length && !newName) { m.close(); return; }
      m.close(); stageTagChanges(ids, add, rem, newName);
    }, text: "Klaarzetten" }));
  }
  // Read each selected fiche → compute new tag set → stage into pending (no separate confirm).
  function stageTagChanges(ids, add, rem, newName) {
    var prog = progressModal("Tags klaarzetten");
    var createTags = newName ? [{ name: newName, color: "#e0e0e0" }] : [];
    runSequential(ids, function (id) {
      var f = fiskById(id); if (!f) return Promise.resolve();
      return readFicheEdit(id).then(function (edit) {
        var cur = (edit.tags || []).map(function (t) { return String(t.id); });
        var set = {}; cur.forEach(function (x) { set[x] = true; });
        add.forEach(function (x) { set[String(x)] = true; }); rem.forEach(function (x) { delete set[String(x)]; });
        var next = Object.keys(set);
        var change = { label: "Tags", oldEl: chipRow(cur.map(Number)), newEl: chipRow(next.map(Number)) };
        if (newName) change.newEl = h("div", {}, [chipRow(next.map(Number)), h("span", { class: "qwl-chip", text: "＋ " + newName })]);
        stagePending(f, edit, { tags: next, create_tags: createTags }, [change]);
      });
    }, prog.update).then(function (fails) { prog.done(fails, ids.length); renderList(); if (!fails.length) setStatus(pendCount() + " wijziging(en) klaargezet — druk 'Wijzigingen controleren'."); });
  }

  // ------------------------------------------------------------------------
  //  Backup-on-delete — dump full editable content to a JSON file before the
  //  irreversible DELETE, so deleted fiches (incl. ZILL/OPSTAP goals) can be rebuilt.
  // ------------------------------------------------------------------------
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function tsStamp() { var d = new Date(); return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "-" + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()); }
  function downloadFichesBackup(data) {
    try {
      var payload = { tool: "Questi Lesfiche-manager", exported_at: new Date().toISOString(), count: data.length, fiches: data };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = h("a", { href: url, download: "questi-lesfiches-backup-" + tsStamp() + ".json", style: "display:none" });
      mgr.els.page.appendChild(a); a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 0);
      return true;
    } catch (e) { console.error("[QWL] backup-download faalde:", e); return false; }
  }
  // Read full content per id (best-effort, sequential), download whatever we captured,
  // and report which ids failed to read. Never deletes — that's the caller's decision.
  function backupBeforeDelete(ids, prog) {
    var captured = [];
    return runSequential(ids, function (id) {
      return readFicheEdit(id).then(function (edit) {
        var f = fiskById(id);
        captured.push({
          id: id,
          subject: (edit && edit.subject) || (f && f.subject) || "",
          grades: (edit && edit.grades) || (f && f.grades) || [],
          tags: (edit && edit.tags) || [],
          tagIds: mgr.tagChips[id] || [],
          fields: (edit && edit.fields) || []
        });
      });
    }, function (done, total) { if (prog) prog.update(done, total); }).then(function (fails) {
      // Record read-failures too, with whatever list-level data we still have.
      fails.forEach(function (fl) { var id = fl.item, f = fiskById(id); captured.push({ id: id, subject: (f && f.subject) || "", grades: (f && f.grades) || [], tagIds: mgr.tagChips[id] || [], fields: [], __backup_incomplete: true }); });
      var downloaded = downloadFichesBackup(captured);
      return { downloaded: downloaded, failed: fails };
    });
  }

  // ------------------------------------------------------------------------
  //  Bulk delete — typed confirm + test-one-first (irreversible)
  // ------------------------------------------------------------------------
  function openDeleteModal() {
    var ids = selectedIds(); if (!ids.length) return;
    var list = ids.map(function (id) { var f = fiskById(id); return h("div", { class: "qwl-delrow", text: (f ? ficheName(f) : ("#" + id)) + "  ·  #" + id }); });
    var typed = h("input", { class: "qwl-input", type: "text", placeholder: "typ VERWIJDER" });
    var m = modal("Verwijderen — " + ids.length + " fiches", [
      h("div", { class: "qwl-note qwl-warn", text: "Definitief en onomkeerbaar — geen server-undo. Typ VERWIJDER om te bevestigen." }),
      h("div", { class: "qwl-dellist" }, list), typed
    ], [], "wide");
    var ft = m.querySelector(".qwl-modal-ft");
    var btnTest = h("button", { class: "qwl-btn qwl-danger", disabled: "true", onclick: function () { doDelete(m, ids, true); }, text: "Verwijder 1 (test)" });
    var btnAll = h("button", { class: "qwl-btn qwl-danger", disabled: "true", onclick: function () { doDelete(m, ids, false); }, text: "Verwijder alle" });
    typed.addEventListener("input", function () { var ok = (typed.value || "").trim() === "VERWIJDER"; btnTest.disabled = ok ? null : "true"; btnAll.disabled = ok ? null : "true"; });
    ft.appendChild(h("button", { class: "qwl-btn qwl-ghost", onclick: m.close, text: "Annuleer" }));
    ft.appendChild(btnTest); ft.appendChild(btnAll);
  }
  function doDelete(m, ids, testOnly) {
    var batch = testOnly ? ids.slice(0, 1) : ids;
    m.close();
    var prog = progressModal(testOnly ? "Testverwijdering" : "Verwijderen");
    prog.update(0, batch.length);
    setStatus("Back-up maken vóór verwijderen…");
    // Irreversible: back up FULL content first, then delete. If the backup couldn't be fully
    // captured, make the user explicitly confirm deleting without a complete safety net.
    backupBeforeDelete(batch, prog).then(function (backup) {
      if (backup.failed.length && !window.confirm("Back-up mislukt voor " + backup.failed.length + " van " + batch.length + " fiche(s). Toch definitief verwijderen zonder volledige back-up?")) {
        prog.done([{ error: "Geannuleerd — geen volledige back-up." }], batch.length);
        return;
      }
      prog.update(0, batch.length);
      return deleteFiches(batch).then(function () {
        var gone = {}; batch.forEach(function (id) { gone[id] = true; delete mgr.selected[id]; delete mgr.tagChips[id]; });
        mgr.fiches = mgr.fiches.filter(function (f) { return !gone[f.id]; });
        prog.done([], batch.length); applyFilter();
        setStatus(testOnly ? "1 verwijderd (back-up gedownload) — controleer in Questi, verwijder daarna de rest." : (batch.length + " verwijderd — back-up gedownload."));
      });
    }).catch(function (e) { prog.done([{ error: (e && e.message) || String(e) }], batch.length); });
  }

  // ------------------------------------------------------------------------
  //  Progress modal
  // ------------------------------------------------------------------------
  function progressModal(title) {
    var bar = h("div", { class: "qwl-bar-fill" });
    var txt = h("div", { class: "qwl-prog-txt", text: "0 / ?" });
    var m = modal(title, [txt, h("div", { class: "qwl-bar" }, [bar])], [], "");
    return {
      update: function (done, total) { txt.textContent = done + " / " + total; bar.style.width = total ? Math.round(done / total * 100) + "%" : "0%"; },
      done: function (fails, total) {
        var ft = m.querySelector(".qwl-modal-ft");
        m.querySelector(".qwl-prog-txt").textContent = fails && fails.length ? (fails.length + " van " + total + " mislukt.") : ("Klaar — " + total + " verwerkt.");
        if (fails && fails.length) m.querySelector(".qwl-modal-bd").appendChild(h("div", { class: "qwl-note qwl-warn", text: fails.map(function (f) { return f.error; }).slice(0, 8).join(" · ") }));
        ft.innerHTML = ""; ft.appendChild(h("button", { class: "qwl-btn", onclick: m.close, text: "Sluiten" }));
      }
    };
  }

  // ========================================================================
  //  Import (Phase 2 — SCAFFOLD, gated by mgr.importEnabled; OPSTAP resolver stubbed)
  //  Barebones so August only needs resolveGoals() + a host permission + enabling the button.
  // ========================================================================
  var _templatesCache = null;
  function fetchTemplates() {
    if (_templatesCache) return Promise.resolve(_templatesCache);
    return jget(api() + "/lessons/templates?" + qs({ schoolId: sid() })).then(function (j) { _templatesCache = (j && j.result) || []; return _templatesCache; });
  }
  // Split pasted CSV/TSV into row objects. First line = header. No silent magic.
  function parseImport(text) {
    var lines = String(text || "").replace(/\r/g, "").split("\n").filter(function (l) { return l.trim() !== ""; });
    if (!lines.length) return [];
    var delim = lines[0].indexOf("\t") !== -1 ? "\t" : (lines[0].indexOf(";") !== -1 ? ";" : ",");
    var head = lines[0].split(delim).map(function (s) { return s.trim().toLowerCase(); });
    return lines.slice(1).map(function (ln) {
      var cells = ln.split(delim), row = {};
      head.forEach(function (col, i) { row[col] = (cells[i] || "").trim(); });
      return row;
    });
  }
  // TODO(OPSTAP): map leerplandoelen codes → ZILL numeric goal ids (via /lessons/goals/36).
  // Until then, return [] and flag every code as unresolved so nothing is silently wrong.
  function resolveGoals(codes) { return { selected_goals: [], unresolved: (codes || []).slice() }; }
  // Build a POST /cal/lessons body for one import row against a template's structure.
  function buildCreateBody(row, template, tagIds) {
    var fields = ((template && template.structure) || []).map(function (fld) {
      if (fld.type === "goals") { var g = resolveGoals((row.leerplandoelen || "").split(/[;,\s]+/).filter(Boolean)); return { field_type: "goals", template_field_id: fld.id, selected_goals: g.selected_goals }; }
      var map = { doelen: row.doelen, lesverloop: row.lesverloop, materiaal: row.materiaal };
      var content = map[(fld.title || "").toLowerCase()] != null ? map[(fld.title || "").toLowerCase()] : "";
      return { field_type: "text", template_field_id: fld.id, content: content };
    });
    return { schoolId: sid(), subject: row.titel || "", grades: row.leerjaar ? [row.leerjaar] : [], visibility: "school", tags: tagIds || [], create_tags: [], attachments: [], templateId: template && template.id, fields: fields };
  }
  function createFiche(body) {
    return fetch(api() + "/lessons?return_format=short", { method: "POST", credentials: "include", headers: S().writeHeaders(), body: JSON.stringify(body) }).then(resolveJson("POST lesson", body.subject, body));
  }
  // Minimal preview view — only reachable when importEnabled (dormant scaffold for now).
  function openImportView() {
    var ta = h("textarea", { class: "qwl-textarea", rows: "8", placeholder: "Plak hier je CSV/Excel-rijen (eerste regel = kopregel: titel;vak;leerjaar;doelen;leerplandoelen;lesverloop;materiaal)" });
    var preview = h("div", { class: "qwl-import-preview" });
    var m = modal("Importeren (bèta)", [
      h("div", { class: "qwl-note", text: "Scaffold — OPSTAP-doelen worden later toegevoegd. Niets wordt geschreven zonder dry-run + 'Test 1 fiche'." }),
      ta, h("button", { class: "qwl-btn qwl-ghost", onclick: function () { renderPreview(); }, text: "Voorbeeld tonen" }), preview
    ], [], "wide");
    function renderPreview() {
      preview.innerHTML = "";
      var rows = parseImport(ta.value);
      if (!rows.length) { preview.appendChild(h("div", { class: "qwl-note", text: "Geen rijen." })); return; }
      rows.slice(0, 50).forEach(function (r) { preview.appendChild(h("div", { class: "qwl-delrow", text: (r.titel || "(zonder titel)") + "  ·  " + (r.vak || "?") + "  ·  " + (r.leerjaar || "?") })); });
      preview.appendChild(h("div", { class: "qwl-note", text: rows.length + " rij(en). (Wegschrijven nog niet actief — OPSTAP volgt.)" }));
    }
    var ft = m.querySelector(".qwl-modal-ft"); ft.appendChild(h("button", { class: "qwl-btn", onclick: m.close, text: "Sluiten" }));
  }

  // ========================================================================
  //  Diagnose / Zelftest (read-only — never writes)
  // ========================================================================
  function diagGet(path) {
    return fetch(path, { credentials: "include", headers: { "Accept": "application/json" } }).then(function (r) {
      var ct = r.headers.get("content-type") || "";
      if (ct.indexOf("json") < 0) return { status: r.status, json: null, html: true };
      return r.json().then(function (j) { return { status: r.status, json: j, html: false }; }).catch(function () { return { status: r.status, json: null, html: false }; });
    }).catch(function () { return { status: 0, json: null }; });
  }
  function has(o, k) { return o && Object.prototype.hasOwnProperty.call(o, k) && o[k] != null; }
  function openDiag() {
    var list = h("div", { class: "qwl-diag-list" }), rows = [];
    function pill(s) { return h("span", { class: "qwl-diag-pill " + s.toLowerCase(), text: s }); }
    function addRow(row) { rows.push(row); list.appendChild(h("div", { class: "qwl-diag-row" }, [h("div", { class: "qwl-diag-hd" }, [pill(row.status), h("span", { class: "qwl-diag-name", text: row.name })]), (row.detail ? h("div", { class: "qwl-diag-detail", text: row.detail }) : null), (row.status !== "OK" && row.next ? h("div", { class: "qwl-diag-next", text: "→ " + row.next }) : null)])); list.scrollTop = list.scrollHeight; }
    function copyReport() {
      var lines = ["Questi Lesfiche-manager — Zelftest", "", ]; rows.forEach(function (r) { lines.push("[" + r.status + "] " + r.name + (r.detail ? " — " + r.detail : "") + (r.status !== "OK" && r.next ? " — " + r.next : "")); });
      var text = lines.join("\n");
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { setStatus("Rapport gekopieerd."); }); else { var t = document.createElement("textarea"); t.value = text; mgr.els.page.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e) {} t.remove(); }
    }
    var m = modal("Zelftest — leest alleen, schrijft nooit", [h("div", { class: "qwl-note", text: "Controleert of de live Questi-API nog overeenkomt met wat de manager verwacht." }), list], [], "wide");
    var ft = m.querySelector(".qwl-modal-ft");
    ft.appendChild(h("button", { class: "qwl-btn qwl-ghost", onclick: copyReport, text: "Rapport kopiëren" }));
    ft.appendChild(h("button", { class: "qwl-btn", onclick: m.close, text: "Sluiten" }));
    runDiag(addRow);
  }
  function runDiag(addRow) {
    var sampleFicheId = null, userTag = mgr.ownTags.filter(function (t) { return t.type !== "default"; })[0];
    var checks = [
      function () { return diagGet(api() + "/lessons?" + qs({ schoolId: sid(), status: "active", num: 1, offset: 0, default_tagId: allOwnTagId() })).then(function (r) {
        if (r.html || r.status === 401 || r.status === 403) { addRow({ status: "FAIL", name: "Auth & connectiviteit", detail: "geen JSON / " + r.status, next: "Open Questi en log in." }); return "STOP"; }
        var arr = (r.json && r.json.result) || []; sampleFicheId = arr[0] && arr[0].id;
        addRow({ status: r.status === 200 ? "OK" : "WARN", name: "Auth & eigen-lijst", detail: "num_records " + (r.json && r.json.num_records) + ", velden " + (arr[0] ? Object.keys(arr[0]).filter(function (k) { return ["id", "subject", "grades"].indexOf(k) !== -1; }).join("/") : "—") });
      }); },
      function () { return diagGet(api() + "/lessons/tags?" + qs({ schoolId: sid(), filter: "own" })).then(function (r) {
        var arr = (r.json && r.json.result) || [], kids = arr.filter(function (t) { return String(t.parent) !== "0"; });
        addRow({ status: arr.length ? (kids.length ? "OK" : "WARN") : "FAIL", name: "Eigen tags (+ subtags)", detail: arr.length + " tags, " + kids.length + " subtags", next: kids.length ? null : "Geen subtags — vak-filters tonen niets onder de vakken." });
      }); },
      function () { if (!userTag) { addRow({ status: "SKIP", name: "Tag-parameter (user_tagId)", detail: "geen user-tag" }); return; } return diagGet(api() + "/lessons?" + qs({ schoolId: sid(), status: "active", num: 1, user_tagId: userTag.id })).then(function (r) {
        addRow({ status: r.status === 200 ? "OK" : "FAIL", name: "Tag-parameter (user_tagId)", detail: "HTTP " + r.status + " voor tag " + userTag.id, next: r.status === 200 ? null : "user_tagId werkt niet meer — controleer de tag-filter." });
      }); },
      function () { return diagGet(api() + "/lessons?" + qs({ schoolId: sid(), status: "active", num: 1, default_tagId: 1 })).then(function (r) { addRow({ status: r.status === 200 ? "OK" : "WARN", name: "Zonder tag (default_tagId=1)", detail: "HTTP " + r.status }); }); },
      function () { if (!sampleFicheId) { addRow({ status: "SKIP", name: "Fiche edit-contract", detail: "geen sample" }); return; } return diagGet(api() + "/lessons/" + sampleFicheId + "?" + qs({ schoolId: sid(), return_format: "edit" })).then(function (r) {
        var res = r.json && r.json.result, fld = res && res.fields && res.fields[0];
        addRow({ status: (res && res.fields && has(fld, "id") && has(fld, "template_field_id")) ? "OK" : "FAIL", name: "Fiche edit-contract", detail: "tags[" + ((res && res.tags) || []).length + "], fields[" + ((res && res.fields) || []).length + "]", next: (res && res.fields) ? null : "return_format=edit levert geen fields — bewerken kan breken." });
      }); },
      function () { return diagGet(api() + "/lessons/templates?" + qs({ schoolId: sid() })).then(function (r) { var arr = (r.json && r.json.result) || []; addRow({ status: arr.length ? "OK" : "WARN", name: "Templates (import)", detail: arr.length + " templates", next: arr.length ? null : "Import nog niet klaar / geen templates." }); }); },
      function () { var t = S().xsrfToken(); addRow({ status: t ? "OK" : "WARN", name: "XSRF-token", detail: t ? "cookie leesbaar" : "leeg", next: t ? null : "Schrijfacties (PATCH/POST/DELETE) hebben x-xsrf-token nodig." }); }
    ];
    var i = 0;
    (function next() { if (i >= checks.length) return; var c = checks[i++]; Promise.resolve().then(c).then(function (r) { if (r === "STOP") return; setTimeout(next, 60); }).catch(function () { setTimeout(next, 60); }); })();
  }

  // ---------- Export ----------
  window.__QWP_LESSONS = { open: open, close: close };
})();
