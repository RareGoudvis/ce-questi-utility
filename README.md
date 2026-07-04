# Questi Weekplanner

Een browserextensie die bovenop de **Questi**-agenda een volledig scherm-weekplanner legt.
Plan in één overzicht een (of twee) volledige lesweken: sleep lesfiches in je lesuren,
maak lesuren leeg, controleer alles in een voorbeeldweergave en schrijf het daarna in één
keer weg naar Questi. Werkt in **Chrome**, **Brave** en **Edge**.

> Je moet ingelogd zijn op [questi.com](https://www.questi.com) — de extensie gebruikt je
> eigen sessie en verandert niets zonder dat jij op **Wegschrijven** klikt.

---

## Installeren (Chrome, Brave of Edge)

De extensie zit niet in de webshops; je laadt ze zelf in ("uitgepakt laden"). Dat is in de
drie browsers bijna identiek.

1. **Download de bestanden.** Klik op deze pagina op de groene knop **`Code` → `Download ZIP`**
   en pak het ZIP-bestand uit naar een map die je makkelijk terugvindt
   (bv. `Documenten/questi-weekplanner`). *Of*, als je Git kent:
   ```
   git clone https://github.com/RareGoudvis/questi-calendar-workflow-fix.git
   ```
   > Belangrijk: onthoud waar de map staat en verwijder ze niet — de browser leest de
   > extensie telkens uit die map.

2. **Open de extensiepagina** in je browser:
   - **Chrome:** typ `chrome://extensions` in de adresbalk en druk Enter.
   - **Brave:** typ `brave://extensions`.
   - **Edge:** typ `edge://extensions`.

3. **Zet "Ontwikkelaarsmodus" aan** (schuifknop rechtsboven, in Edge links).

4. Klik op **"Uitgepakt laden"** (Edge: **"Uitgepakt laden"** / "Load unpacked") en kies de
   **map** die je in stap 1 hebt uitgepakt (de map waarin `manifest.json` staat).

5. Klaar — de "Questi Weekplanner" verschijnt in de lijst. Ga naar je Questi-agenda en je
   ziet er een knop verschijnen (zie hieronder).

> **Bijwerken naar een nieuwere versie:** download opnieuw de ZIP, vervang de bestanden in
> dezelfde map, en klik op de extensiepagina op het **↻ (vernieuwen)**-icoon bij de extensie.

---

## Openen

Op je Questi-agenda (de kalenderpagina) verschijnen **twee knoppen** in de werkbalk, naast de
zoom/Week/print-knoppen:

- **"Weekplanner"** — opent de volledige weekplanner. (Of druk op **Alt + P**, of klik het
  extensie-icoon in je browserwerkbalk.)
- **"Lesfiches"** — opent de **Lesfiche-manager** (zie onder).

De knoppen verschijnen **enkel op de kalenderpagina**. Sluiten doe je met het **✕** rechtsboven
(of **Alt + P** voor de planner).

---

## De weekplanner gebruiken

1. **Kies je week.** In de bovenbalk (naast de zoekbalk) kies je *1 week* of *2 weken* en blader
   je met **← / Deze week / →**.
2. **Zoek lesfiches.** Onderaan staan filterpanelen: kies een vak, verfijn met de sub-tags
   (blok 1, blok 2 …) of gebruik de zoekbalk. Via **Lesfiches laden** (links) laad je je
   **Eigen lesfiches**, die van **Collega's**, of **Methodes** (uitgeverij-fiches — die krijgen
   een oranje **"methode"**-label en zijn alleen-lezen sjablonen).
3. **Plan lesuren.**
   - **Sleep** een lesfiche vanuit een paneel op een leeg lesuur — de titel van het lesuur wordt
     meteen de titel van de fiche.
   - Of **klik** op een lesuur om handmatig een fiche te kiezen, het als gymles te markeren, of
     het **leeg te maken**.
   - Sleep een ingevuld lesuur naar een ander om het te **verplaatsen of te wisselen**.
   - Met **"Add selectie"** vul je meerdere gekozen fiches in één keer in.
   - **Kopieer vorige week** toont een **rooster** — klik de lesuren die je wil overnemen; ze
     landen in de lege lesuren op hetzelfde moment deze week.
4. **Vergist? Ctrl + Z** (of **"Ongedaan maken"**) draait je laatste actie terug.
5. **Controleer & wegschrijven.** Klik **"Controleer & wegschrijven"** voor een voor/na-overzicht
   (groen = gewijzigd, oranje = nog leeg, rood = overschrijft). Klik **"Goedkeuren en
   wegschrijven"** — dat schrijft meteen weg (geen aparte knop meer). Daarna vernieuwt de pagina.

### Goed om te weten

- **Niets wordt geschreven** tot je goedkeurt; tot dan blijft alles enkel in de planner staan.
- Wijzigingen gelden **enkel voor die ene week** (herhalende reeksen blijven ongemoeid).
- **Instellingen** (vast vak per lesuur) blijft bewaard en geldt voor elke week.
- **Diagnose** (links onderaan) draait een zelftest als er iets niet automatisch gevonden werd.

---

## De Lesfiche-manager gebruiken

Open via de **"Lesfiches"**-knop in de werkbalk. Hiermee beheer je je **volledige eigen
fiche-bibliotheek** (los van de kalender).

- **Overzicht + filteren.** Bovenaan staan je tags: **Alle eigen lesfiches**, **Zonder tag**
  (handig om te zien wat nog getagd moet worden / oude leerjaren), en je **vakken**. Klik een vak
  → je ziet **Alle [vak]** (alles onder dat vak, ook via sub-tags) plus de sub-tags (blok 1…).
  Rechts bovenaan filter je op **leerjaar** en zoek je op titel. Klik een **kolomkop** (Titel /
  Leerjaar / Laatst gebruikt / Tags) om te **sorteren**.
- **Titel snel aanpassen.** Klik op een titel in de lijst om hem **direct** te bewerken.
  **Dubbelklik** op een rij voor de volledige editor (titel + inhoud).
- **Meerdere tegelijk.** Vink fiches aan (of **Alles selecteren**), dan links: **Tags bewerken**
  (toevoegen/verwijderen, of een **nieuwe tag** maken) of **Verwijderen**.
- **Eén bevestiging.** Al je wijzigingen (titels, inhoud, tags) worden **klaargezet** en pas
  weggeschreven via **"Wijzigingen controleren"** → goedkeuren. Doelen en niet-gewijzigde tags
  blijven altijd behouden.
- **Verwijderen** is definitief: typ `VERWIJDER`, test eerst met één fiche, dan de rest.
- **1/2 kolommen** en **Diagnose** (zelftest) staan links. **Importeren** komt binnenkort (OPSTAP).

---

## Privacy

De extensie draait volledig in je eigen browser en praat enkel met `questi.com` via je eigen
login. Er worden geen gegevens naar derden gestuurd.

---

# API reference (developer)

> Ground-truth notes on the Questi backend this extension drives. English, dev-facing —
> the user guide above is the product. Companion files with fuller samples:
> [`brief.md`](brief.md) and [`reference/questi-api-samples.md`](reference/questi-api-samples.md).
> All paths are relative to `https://www.questi.com/api`.

## Transport & auth

- Same-origin `fetch(url, { credentials: "include" })` from the content script — the logged-in
  session cookies (`PHPSESSID`, `XSRF-TOKEN`) ride along automatically.
- **Mutations (`POST` / `PATCH` / `DELETE`) must send the header `x-xsrf-token` equal to the
  `XSRF-TOKEN` cookie value** (double-submit CSRF). `GET` needs neither header. Writes also send
  `content-type: application/json` and `origin: https://www.questi.com`.
- No `Authorization`/Bearer header. Everything is cookie + XSRF.
- Errors: HTTP 400 `{ "status":"error", "error_type":"app_error", "error_msg":"<code> - <text>" }`.
  Seen: `1203` tag not yours · `1253` `shared_userId` without a valid tag · `1254` own fetch with
  no tag and no `searchstring`.

## Bootstrap / context

| Call | Gives |
|---|---|
| `GET /users/me` | `result.id` = own user id (owner id on your fiches). |
| `GET /schools` | `result[].id` = **schoolId**. ⚠ `current_schoolyear` is an **object** — never `String()` it; writes need the `"YYYY - YYYY"` label. |
| `GET /cal/calendars?schoolId` | calendar ids (e.g. `cal_95193`) for the `calendars[]` read filter. |

Load order: `users/me` → `schools` → `cal/calendars` → `cal/items`.

## Calendar reads

- `GET /cal/items?schoolId&calendars[]=…&startdate&enddate` — week list. **Do not send
  `schoolyear`** (a bad/object value 500s it). `startdate`/`enddate` carry the time (`…T08:35:00…`).
- `GET /cal/items/{id}?schoolId` — detail: `description`, `starttime`, `endtime`, `attachments[]`
  (`content.id` = linked lesson id; `id_type:1` = lesfiche). ⚠ `id_attachment` changes on every
  re-link — never cache it.
- `GET /cal/items/count?schoolId&calendars[]&startdate&enddate` — per-day counts.

## Fiche & tag reads

- `GET /cal/lessons?schoolId&sorting=new_items&status=active&num&offset&default_tagId={id}[&shared_userId={colleagueId}]`
  — server-side **tag-filtered** fiche list; page with `num`/`offset` (100/page). Response
  `{ result:[…], num_records }`. **The list carries no per-fiche tags** — membership is discovered
  by *which* `default_tagId` you fetched. (`user_tagId={id}` is an equivalent filter param.)
  Never send an empty `searchstring` (400) — omit it.
- Default/root tag ids (per user; never hardcode): `5` = all own, `1` = untagged, `2` = samenwerk,
  `8` = universal (only valid with `shared_userId`). Resolve the own "all" tag by matching
  `/alle.*lesfiches/i` among `type:"default", parent:0` tags.
- `GET /cal/lessons/tags?schoolId&filter=own|shared&active_users=true` — tag tree. Tag object:
  `{ id, title, color(hex), parent (0 = root), type:"user"|"default", number_of_lessons, owner{…} }`.
- `GET /cal/lessons/{id}?schoolId&return_format=edit` — the editable fiche: `subject`,
  `tags:[{id,title,color}]`, `grades`, and `fields[]` each `{ id (field-instance id),
  type:"text"|"goals"|"methods", template_field_id, content | content.goals }`. **This is the
  source of truth for any write** — you need `fields[].id` and the current `tags[]`.
- `GET /cal/lessons/possible-settings?schoolId` → `{ co_owners[], grades[], visibilities:["private","school"] }`.

## Fiche writes — CRUD

**Create** — `POST /cal/lessons?return_format=short`
```json
{ "schoolId":1010, "subject":"Titel", "grades":["L3"], "visibility":"school",
  "tags":[<existingTagId>…], "create_tags":[{ "name":"Nieuw", "color":"#e0e0e0" }],
  "attachments":[], "templateId":56559,
  "fields":[
    { "field_type":"text",  "template_field_id":"236b565a", "content":"<html>" },
    { "field_type":"goals", "template_field_id":"4eef24c6", "selected_goals":[101598,101606] } ] }
```
→ `result.id` = new fiche id.

**Edit** — `PATCH /cal/lessons/{id}?return_format=short`
```json
{ "lessonId":15966963, "subject":"Titel", "schoolId":1010, "attachments":[],
  "tags":[1735707,1796445], "create_tags":[],
  "fields":[
    { "template_field_id":"236b565a", "id":96254544, "content":"…" },
    { "template_field_id":"4eef24c6", "id":96254547 } ] }
```
Per-key semantics (learned the hard way — see the gotchas):
- **`tags[]` = FULL REPLACE.** Echo the fiche's *current* tag ids or a title-only edit **wipes**
  its tags. This is also how you **add/remove a tag**: read current, add/filter, PATCH.
  `create_tags:[{name,color}]` creates + attaches a new tag inline.
- **Goals field: OMIT `selected_goals`.** Send the goals field entry (`{template_field_id, id}`)
  with **no** `selected_goals` key → goals unchanged. **Never send `selected_goals:[]`** (clears).
- **Include every `fields[]` entry** from the edit-read so none drop; put `content` only on the
  text fields you change (echo current `content` on the rest).
- ⚠ **Every edit mints a NEW `result.id` ≠ `lessonId`.** Re-read `result.id` and use it for any
  later op.

**Delete** — `DELETE /cal/lessons?schoolId&lessons[]=<id>[&lessons[]=<id>…]`
Bulk, **no body**, `x-xsrf-token` required → `{ "status":"success" }`. **Irreversible — no server
undo.** ⚠ **Send NO `content-type` header** on this bodyless DELETE — `application/json` with an
empty body makes Questi return **HTTP 500**. (Observed but unused:
`DELETE /cal/lessons/user-tags/{tagId}?schoolId&action=unlink`, null body — ambiguous fiche target;
the PATCH-`tags[]` path above is the deterministic one.)

**Tag filtering (reads)** — a **default-bucket** tag (Alle=5 / Zonder tag=1 / Samenwerk=2) filters
with `default_tagId=<id>`; a **user category** tag (a vak or sub-tag) filters with
`user_tagId=<id>`. Sending `default_tagId` for a user tag **400s**. ⚠ Filtering by a **parent**
subject tag does **not** include fiches tagged only under a **child** — fetch the parent + all
children and merge (union) to see everything under a vak.

## Calendar writes (planner)

- `PATCH /cal/items/{id}?schoolId&schoolyear=YYYY - YYYY&apply_to_next_items=false` — single
  occurrence only. Body has **no `attachments` key**; `groups` are OBJECTS `[{groupId,schoolId}]`;
  writes **do** send `schoolyear`. Recurring items also take `range_startdate`/`range_enddate`.
- `POST /cal/items/{id}/attachments?schoolId&schoolyear` — link a fiche. Here `groups` are **raw
  ids** `[326]`; `id` = `attachments[0].content.id` from fiche detail; `typeId:1`. No DELETE verb
  for attachments — detach = PATCH the item without it.
- Read→write field renames: `content.id → id`, `id_type → typeId`, `is_visible_* → visible_*`.

## Methode-fiches (vendor libraries — read-only)

The planner can load publisher method libraries and treat each as a pseudo-colleague so their
fiches appear in the owner selectors, filter panels, and global search (badged **"methode"**).

- `GET /cal/manage/methods/{schoolId}` → `result[]` each `{ id (KEY), publisher{name}, name,
  grades[], is_cluster, has_concordance, available }` — the pick list.
- `GET /cal/methods/{KEY}/lessons?is_cluster=<bool>&schoolId` → `result[]` each `{ id, subject,
  last_used_date, grades }` (no tags, no owner; full list in one shot — no server paging).
- **Scheduling a methode fiche uses a dedicated attach endpoint** — the normal
  `POST /cal/items/{id}/attachments` 400s with `1235 - no access to lesson`. Instead:
  `POST /cal/items/{id}/attachments/methodlesson?schoolId&schoolyear` with body
  `{ schoolId, visible_parents, visible_students, students:[], groups:[<raw ids>], id:<methodeFicheId> }`
  — **same shape minus `typeId`**. Response carries the decorated title (reuse it for the item PATCH).
- Implementation: a chosen methode becomes a colleague entry `{ id:"method:<KEY>", isMethod:true,
  methodKey, isCluster }`; `fetchFiches`/`fetchFichesByTag` short-circuit method owners to the
  methods endpoint, stamping each fiche `__method` + recording its id in `view.methodFicheIds` so
  the commit routes it to `methodlesson` and the UI badges it "methode".

## Templates & goals (import — Phase 2)

- `GET /cal/lessons/templates?schoolId` → `result[]` each `{ id, name, structure[] }`. A
  `structure[]` item's `id` **is** the `template_field_id`; `type` ∈ text|goals|methods; goals
  fields carry `source.version.id` (ZILL = 36); methods carry a `method{}` concordance.
- `GET /cal/lessons/goals/36?goals[]=<original_id-uuid>…` → ZILL tree. Nodes:
  `{ id (numeric), code, title, is_goal, original_id (uuid), children[] }`. The **numeric `id`**
  goes in a create's `selected_goals`; the **`original_id` uuid** is the query key.

## Gotchas checklist

- `current_schoolyear` is an **object** — derive the `"YYYY - YYYY"` label, never `String()`.
- **`x-xsrf-token` header on every write** (mirror the `XSRF-TOKEN` cookie).
- Never send an empty `searchstring` (400) — omit it.
- **Re-read `result.id` after every fiche PATCH** — the id changes each edit.
- Fiche edit: **`tags[]` is replace** (echo to keep) but **`selected_goals` is omit-to-keep**
  (never `[]`). Different rules — don't conflate them.
- Don't cache `id_attachment`; re-read `content.id` at commit time.
- Single occurrence only on calendar writes (`apply_to_next_items=false`).
- Fiche delete is irreversible — gate behind a typed confirm + test-one-first.

## Extension file map

| File | Role |
|---|---|
| `manifest.json` | MV3; content scripts `planner.js` → `lessons.js` → `content.js`, css `planner.css` + `lessons.css`, on `*://www.questi.com/*`. |
| `background.js` | Service worker; relays the toolbar/Alt+P toggle to the tab. |
| `content.js` | Boot/relay; injects the **Weekplanner** + **Lesfiches** toolbar chips (only on `…/calendar`). |
| `planner.js` / `planner.css` | The week planner (`#qwp-overlay`). Exports `window.__QWP_SHARED` (ctx + helpers) and `window.__QWP_OPEN_LESSONS`. |
| `lessons.js` / `lessons.css` | The Lesfiche-manager (`#qwl-overlay`); consumes `__QWP_SHARED`; own storage key `qwp_lessons_v1`. |
