# CLAUDE.md — Questi Week Planner

Chrome MV3 extension that overlays planning tools on `questi.com`, a Belgian primary-school
platform. Written for and used by a teacher; also shared with colleagues.

**Read this before editing.** `README.md` has the user guide plus a full API reference; the
ground-truth request/response captures live in `reference/questi-api-samples.md`.

## Golden rules

1. **No build step.** Plain ES5-style IIFEs (`var`, `function`, no modules, no `import`).
   No npm, no bundler, no transpiler, no tests. Files are loaded directly by the manifest.
   Do not introduce a toolchain.
2. **Nothing hardcoded per account.** `schoolId`, `schoolyear`, `calendarId`, `groupId`,
   `ownerId`, `ownDefaultTagId` are all runtime-detected into `ctx` by `detectContext()`.
   Never hardcode an id, a tag id, or a user id.
3. **No silent magic.** If something is guessed, degraded, skipped or fell back, the UI says so.
   Prefer a visible note over a clever inference.
4. **Writes are gated.** Every mutation goes through a dry-run the user approves. Calendar writes
   are single-occurrence only (`apply_to_next_items=false`) — never touch a recurring series.
5. **Light theme only.** All CSS namespaced under the module's overlay id.
6. **Dutch UI strings.** Code, comments and commits in English.
7. **Reuse before writing.** Check `__QWP_SHARED` and the sibling modules first — a helper for
   what you need usually already exists. (A duplicate `fetchAllFichesByTag` once shadowed the
   real one and shipped a bug; function declarations hoist, the last one wins.)

## Layout

Flat repo. `icons/` and `reference/` are the only folders.

| File | Lines | Role |
|---|---|---|
| `manifest.json` | | MV3. Permissions `storage, activeTab, scripting`. Hosts `*://*.questi.com/*` + `raw.githubusercontent.com` (self-update check). |
| `background.js` | 41 | Service worker. Relays the toolbar/Alt+P toggle to the tab; serves `QWP_CHECK_VERSION`. |
| `content.js` | 131 | Boot/relay. Injects the toolbar chips into Questi's calendar header. Builds no UI itself. |
| `planner.js` / `planner.css` | 3179 / 474 | Week planner `#qwp-overlay`. Also holds context detection, the API layer, print, and the Zelftest. Exports `__QWP_SHARED`. |
| `lessons.js` / `lessons.css` | 1035 / 157 | Lesfiche-manager `#qwl-overlay`. Fiche + tag CRUD, and a read-only pick mode. |
| `methodes.js` / `methodes.css` | 802 / 153 | Methodevoortgang `#qwm-overlay`. Read-only progress tracker. |
| `version.json`, `update.bat` | | Self-update: `.bat` pulls the repo ZIP; the in-app banner compares `manifest.json` against the GitHub `version.json`. Bump **both** on release. |

Docs (all gitignored except `README.md`): `brief.md` (API/build reference), `featues.md` (sic —
Zelftest spec), `planned.md` (planner polish log), `plannedfeature.md` (Lesfiche CRUD / import
roadmap), `reference/questi-api-samples.md` (captured calls).

## Load order and wiring

`content_scripts.js` order is **significant**:

```
planner.js  →  lessons.js  →  methodes.js  →  content.js
```

`planner.js` defines the shared bridge; the others consume it; `content.js` boots last and injects
the chips. There are no modules — everything crosses file boundaries through `window` globals:

| Global | Set by | Purpose |
|---|---|---|
| `__QWP_SHARED` | planner | ctx + API + DOM helpers used by lessons/methodes |
| `__QWP_TOGGLE` | planner | open/close the planner (action click, Alt+P) |
| `__QWP_OPEN_LESSONS` | planner | open the Lesfiche-manager |
| `__QWP_PRINT` | planner | headless print — does not need the overlay |
| `__QWP_TEST` | planner | debug handles |
| `__QWP_LESSONS` | lessons | `{ open, close, openPicker, runSequential }` |
| `__QWP_METHODES` | methodes | `{ open, close }` |
| `__QWP_BOOTED` | content | double-injection guard |

Each consumer starts with `function S() { return window.__QWP_SHARED; }`. Adding a helper to a
consumer that planner already has is a bug — export the existing one instead.

`__QWP_SHARED` currently exposes: `ctx, API, API_ROOT, jget, qs, xsrfToken, writeHeaders,
fetchTags, fetchOwnTags, fetchSharedTags, invalidateOwnTags, topTagsForOwner, childTags, tagTitle,
tagColor, ownerName, h, detectContext, fetchMethods, fetchMethodLessons, fetchAllFichesByTag,
storeGet, storeSet`.

## UI conventions

- **No HTML files.** All DOM is built with the hyperscript helper `h(tag, attrs, kids)` in
  `planner.js`, shared as `S().h`. `attrs` understands `class`, `text`, `style`, `on*` handlers;
  anything else becomes an attribute, and `null` values are skipped.
- Each module owns a fullscreen overlay and a CSS prefix: `qwp-` (planner), `qwl-` (lessons),
  `qwm-` (methodes). Never style a bare element globally.
- z-index: planner `2147483000` < methodes `2147483050` < lessons `2147483100` — the manager opens
  *on top of* the methodes panel in pick mode.
- Design tokens are duplicated per overlay as CSS custom properties (`--ink --muted --line
  --surface --accent #304651 --accent2 #e4e642 --change #137a3a --thema --danger`), matching
  Questi's own Angular-Material theme.
- Overlays set `html.qwX-locked` to freeze the page behind them.

## Storage

`chrome.storage.local` with a `localStorage` fallback. No sync, no IndexedDB.

| Key | Owner | Contents |
|---|---|---|
| `qwp_state_v6` | planner | colleagues, `settings` (slot→tag map keyed `"<dayIdx>\|<HH:MM>"`), weeks, panels, split ratio, manual overrides |
| `qwp_lessons_v1` | lessons | last tag, page size, columns, sort |
| `qwp_methodes_v1` | methodes | methode definitions, order, manual overrides |

Generic `storeGet(key)` / `storeSet(key, val)` live in `planner.js` and are shared — use them
rather than a fourth copy of the pattern.

## The Questi API

Base `"/api/cal"` (`API`), `"/api"` (`API_ROOT`). Same-origin `fetch(url, {credentials:"include"})`
— the logged-in session cookies ride along. **Mutations must send `x-xsrf-token` equal to the
`XSRF-TOKEN` cookie** (double-submit CSRF); `writeHeaders()` does this.

Reads: `/cal/items` (range; no `schoolyear` param — a non-primitive 500s it), `/cal/items/{id}`
(adds `description`, `attachments[].content`, real `groups`), `/cal/lessons` (fiches; paged via
`num`/`offset`, envelope carries `num_records`), `/cal/lessons/tags`, `/cal/lessons/{id}?return_format=edit`,
`/cal/manage/methods/{schoolId}` and `/cal/methods/{KEY}/lessons` (vendor libraries, read-only,
**unpaged** — one call returns everything), `/cal/lessons/templates`.

Writes: `PATCH /cal/items/{id}` (writes **do** send `schoolyear`; `groups` are objects),
`POST /cal/items/{id}/attachments` (here `groups` are raw numeric ids), the separate
`…/attachments/methodlesson` for methode fiches, and `POST|PATCH|DELETE /cal/lessons`.

### Gotchas that have bitten before

- `current_schoolyear` from `/schools` is an **object**, never `String()` it.
- Own fiche fetches need the user's personal `default_tagId`; a real category tag uses
  `user_tagId` instead. Tag 8 is only valid with `shared_userId` (else error `1203`).
- `PATCH /cal/lessons/{id}` returns a **different** `result.id` — each edit mints a new version.
  Re-read it.
- Fiche edit: `tags[]` is **replace** (echo to keep) but `selected_goals` is **omit-to-keep**
  (never send `[]`). Different rules — do not conflate.
- Bodyless `DELETE` must send **no** `Content-Type`, else HTTP 500.
- Methode fiches carry no tags and no owner, and cannot use the normal attachment endpoint.
- `last_used_date` may be `null`, `"0000-00-00"`, or a bare year — guard all three.

## Feature notes

**Planner.** Week grid is one CSS Grid so two weeks sit side by side. Rows, breaks and no-school
days are all derived from the data, never hardcoded. `vak` (subject) is not an API field — it is
the teacher's per-timeslot tag mapping from `state.settings`. Commit path is
`buildCommitPlan` → review diff → `doCommit`. Ctrl+Z undo stack, cap 30.

**Thema rows** (whole-week full-day items: WO, Godsdienst, …). One row per distinct `themaKey`,
so a third thema needs no code change. The key is stamped **once from `origTitle`** by
`stampThemaKey` and resolved against the live top tags (with `VAKKEN[].re` bridging abbreviations
like "WO" → *Wereldoriëntatie*); unmatched items get `"title:<normalised>"` and their own labelled
row. **Never key a thema row off `slot.title`** — `assignFiche` overwrites it with the fiche title,
which is exactly how two themafiches once collapsed into one row. `ensureThemaKeys` re-stamps
before each render because boot fetches tags and the week in parallel. Full-day items must not read
`state.settings`: with no start time they all share the key `"<dayIdx>|"`, so their `vak` comes from
`themaTagId`. A thema slot **keeps** `themaFiche` when it receives a fiche, so `descFor` goes on
writing `"Zie themafiche."`.

**Lesfiche-manager.** Edits are *staged* into `mgr.pending` and only written through the
"Wijzigingen controleren" gate. Tag catalog CRUD writes immediately. Bulk delete is guarded by a
typed `VERWIJDER` plus an automatic JSON backup. `openPicker({title, preselected, startTagId,
onDone, onCancel})` opens the same overlay in **read-only pick mode**: every write affordance is
hidden, and `mgr.pickStore` keeps selections alive across tag switches.

**Methodevoortgang.** Read-only. Status derives from one field: `last_used_date` inside the chosen
school year. Two sources — a Questi vendor library, or your own fiches picked once via
`openPicker`. Blocks come from **subtags** for own-fiche methodes and from parsed titles for vendor
ones; rows are sorted by block rank so a thema is never split. Only the teacher's decisions
persist; titles and dates are re-fetched live every open. Note Questi rolls `schoolyear` in summer,
so between the roll and 1 September nothing counts as given — hence the explicit year picker.

**Zelftest** (`planner.js` `runDiagnostics`, smaller twin in `lessons.js`). Strictly read-only.
Compares live responses against captured shapes and emits OK/WARN/FAIL/SKIP rows with
`expected`/`found`/`next`, copyable as plain text. **When you add a feature that depends on an API
shape, add a check here.**

**Open question — can a methode fiche's content be read?** Nothing in the codebase has ever
deliberately tried. It matters because "copy a methode fiche into my own library" (planned, parked
until Questi ships the new-curriculum fiches) is impossible without it. `probeMethodLesson` in
`lessons.js` answers it: it GETs a real methode lesson with `return_format` `edit`/`view`/`short`
and reports whether `templateId`, `fields[]`, text content, goals and attachments come back. The
copied Zelftest report includes the raw key names. Two related unknowns it does **not** answer,
because both would need a write: whether `attachments: []` on a fiche PATCH wipes existing
attachments, and where the write-side `attachmentId` comes from (it matches neither `content.id`
nor `id_attachment`). Test those by hand on a throwaway fiche.

## Working on this repo

- After editing, reload the extension **and** reload the Questi tab — Chrome keeps old content
  scripts alive in already-open tabs. Each module logs its version on load; a missing line means a
  stale script.
- Syntax check with `node --check <file>` (node is available; it is not a dependency of the addon).
- Verification is manual: load unpacked on a `…/calendar` page and drive the UI. In summer there
  are no lesson items, so `groupId` stays null and several Zelftest rows WARN — that is expected.
- Bump `manifest.json` **and** `version.json` together on release.
