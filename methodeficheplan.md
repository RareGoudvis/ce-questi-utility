# Methodefiche kopiëren — plan van aanpak

> **Status: geparkeerd, wachtend op Questi.** Alles wat zonder de nieuwe methodefiches kon worden
> uitgezocht, is uitgezocht (zie "Wat we zeker weten"). De feature zelf wordt pas gebouwd zodra de
> nieuwe-leerplanmethodes (Camino, rekenroute) in Questi verschijnen.
> Laatste update: 2026-08-16, extensie v1.1.4.

## Doel

Eén, meerdere of alle lessen van een methode selecteren en er **echte eigen lesfiches** van maken,
zodat ze aanpasbaar zijn. Achter een dry-run en een test-één-eerst-poort. Daarna kan de
Methodevoortgang-tracker overschakelen van de vendor-methode naar je eigen kopieën.

Questi biedt dit zelf niet aan en gaat dat ook niet doen — vandaar deze feature.

---

## Wat we zeker weten (bevestigd door capture, 2026-08-16)

| Feit | Bewijs |
|---|---|
| Inhoud van een methodefiche is leesbaar via `GET /cal/methods/{KEY}/lessons/{id}?is_cluster&schoolId` | live capture |
| `GET /cal/lessons/{id}` weigert vendor-inhoud op **elk** return_format met `1235 - no access to lesson` | Zelftest + capture |
| Een methodefiche heeft **precies één veld**, `type:"methods"`, met de doelenboom + concordantie | capture |
| Er is **geen lesverloop/materiaal** in vendor-content — die velden staan in jouw template en vul je zelf | capture |
| `template:null`, `id:null`, `template_field_id:null` — het antwoord is een samengestelde weergave, geen opgeslagen fiche | capture |
| Het juiste template is **exact** te vinden: het template met een `type:"methods"`-veld waarvan `method.id === methodeKey` | capture (56964↔VI_karakter, 31397↔VI_REKENMAAR, 31398↔PL_TAALKANJERS, 31383↔P_NQE) |
| Doelen zijn te halen uit `concordances[].content.goals`: de diepste `is_goal:true`-bladeren | geverifieerd tegen echte data → 101643, 102198, 102199 |
| Leerplanversie staat op het template (`source.version.{id,format_type}`), ZILL 36 én Op.Stap 57 komen voor | capture |
| `last_used_date` kan `""` zijn (niet alleen null / "0000-00-00") | capture |
| `/cal/manage/methods` geeft per methode een `available`-vlag | capture |

**Belangrijke nuance:** het bovenstaande is bewezen op **ZILL-methodes** (Karakter, Reken Maar,
Taalkanjers, Nouveau Quartier Etoile) — precies de methodes die je gaat verlaten. Er is nog **nooit
een Camino- of rekenroute-methodefiche gelezen**; die bibliotheken bestaan nog niet.

De twee Op.Stap-templates die er wél al zijn (59059 Camino, 59128 rekenroute) hebben géén
`methods`-veld, alleen `goals(opstap 57)` + `Lesverloop` + `Materiaal`. Elk ZILL-template dat aan
een methode hangt, heeft dat veld wél. Dat verschil bepaalt welke tak hieronder van toepassing is.

---

## Stap 0 — het startsein

Open de **Lesfiche-manager → Diagnose**. Twee rijen vertellen of het zover is:

- **"Methodes — beschikbaarheid"** — verschijnen Camino / rekenroute hier, en staan ze op
  beschikbaar (dus zonder "(niet beschikbaar)")?
- **"Templates — leerplan + methodekoppeling"** — groeit het aantal `opstap v57`-templates, en
  krijgt er één een methode-veld?

Zolang beide nee zeggen: niets bouwen.

## Stap 1 — de captures (30 minuten werk, bepaalt de rest)

### Capture A — een nieuwe methodefiche lezen
1. Open een Camino- of rekenroute-methodeles in Questi zodat de inhoud op het scherm staat.
2. DevTools → Network, **Preserve log**, filter Fetch/XHR, log wissen, fiche opnieuw openen.
3. Ctrl+Shift+F, zoek op een kenmerkende zin uit de les → dat is het juiste request.
4. Kopieer request-URL + volledige response.

Verwacht: `/cal/methods/{KEY}/lessons/{id}`. Wijkt het af, dan is dát de nieuwe route.

### Capture B — een fiche mét methode-veld aanmaken (**de beslissende**)
1. Maak in Questi met de hand één lesfiche aan op een template dat een **methode-veld** heeft.
2. Kies in dat veld een methodeles.
3. Opslaan, en kopieer de `POST /cal/lessons` request body.

Dit beantwoordt de enige echt open vraag: **kun je een `type:"methods"`-veld schrijven?** De tot nu
toe vastgelegde create-body kent alleen `field_type:"text"` en `field_type:"goals"`.

### Capture C — Op.Stap-doelen schrijven
Maak een fiche op een Op.Stap-template (Camino/rekenroute), kies doelen, sla op, kopieer de body.
Bevestigt dat `selected_goals` met Op.Stap-ids dezelfde vorm heeft als met ZILL-ids.

### Bijvangst — twee onbevestigde risico's
- Wist `attachments: []` in een fiche-PATCH bestaande bijlagen? Test op een wegwerpfiche.
- Waar komt `attachmentId` vandaan bij schrijven? Matcht noch `content.id` noch `id_attachment`.

Beide alleen relevant als je bijlagen wil meekopiëren.

---

## Stap 2 — kies de tak op basis van capture B

### Tak A — methode-veld is schrijfbaar *(beste uitkomst)*
De kopie verwijst naar dezelfde vendor-les. Doelen én concordantie blijven intact en blijven
meebewegen met de uitgever; jij vult enkel lesverloop en materiaal aan.

- `buildCopyBody` zet het `methods`-veld met de referentie uit capture B (waarschijnlijk
  `id_method_lesson`, bv. 36366).
- Overige velden leeg; `subject` en `grades` uit de bronfiche.
- Geen doelen-extractie nodig — de concordantie hangt aan de methodeverwijzing.

### Tak B — methode-veld niet schrijfbaar, maar doelen wel
De kopie krijgt een `goals`-veld met de numerieke ids uit de concordantie.

- Doelen via `leafGoalIds()` (staat al in `lessons.js`, geverifieerd).
- **Open punt:** de boom markeert meerdere niveaus als `is_goal:true` (zowel het generieke doel als
  de leerlijn-bladeren). Welk niveau `selected_goals` verwacht, moet blijken uit capture B/C.
  Bij twijfel: bladeren, en het resultaat in Questi controleren met de test-kopie.
- De vendor-doelentekst (`content.children[].description`, HTML) gaat naar het tekstveld "Doelen"
  als dat in het template bestaat, anders naar het eerste tekstveld — en de dry-run laat zien waar.

### Tak C — geen vendor-methodebibliotheken meer *(reëel scenario)*
Als het nieuwe leerplan geen methode-fiches meer levert, is er niets te kopiëren en vervalt deze
feature. Wat overblijft is een **skeletfiche-generator**: bulk aanmaken van lege eigen fiches met
de juiste titel, leerjaar en tag, op basis van een titellijst.

Beslis dat pas als het zover is — het scheelt 200 titels typen, maar het is een andere feature.

---

## Stap 3 — bouwen (geldt voor tak A en B)

### Waar
In **Methodevoortgang** (`methodes.js`), niet in de Lesfiche-manager: die kan methodefiches
überhaupt niet tonen. De methode is daar al gekozen en de lessen staan al gegroepeerd.

- Selectievakje per lesregel, plus "alles", "geen" en per blok.
- Knop **"Kopieer naar mijn bibliotheek (N)"**, actief bij selectie — zelfde patroon als
  `updateSidebar` in `lessons.js` (label met telling, `disabled = n ? null : "true"`).
- Hiermee wordt `methodes.js` voor het eerst een schrijvende module. Pas de headercomment en
  `CLAUDE.md` aan: het overzicht blijft read-only, kopiëren is een aparte, gepoorte actie.

### Hoe
Schrijf `buildCopyBody(sourceFiche, template, opts)` **naast** `buildCreateBody`
(`lessons.js`) — die laatste is gemaakt voor CSV-rijen, matcht tekstvelden op drie hardgecodeerde
titels en zet `type:"methods"`-velden verkeerd weg als leeg tekstveld. Niet uitbreiden.

- **Template**: exact opzoeken op `method.id === methodeKey`. Geen naamgelijkenis meer nodig.
  Geen match → gebruiker kiest zelf, met de reden erbij.
- **Titel**: identiek aan de bron, met optionele prefix die triviaal te strippen is. Prefix wordt
  op het methode-record bewaard zodat de tracker hem kan wegfilteren bij titelvergelijking.
- **Tag**: één bestaande tag per kopieerronde. Subtags kunnen niet via de API worden aangemaakt
  (Questi negeert `parent`; `applyNewTag` in `lessons.js` waarschuwt daar al voor) — maak
  thema-subtags vooraf met de hand in Questi.
- **Leerjaar**: `grades` uit de bronfiche.
- **Bijlagen**: alleen als de bijvangst-captures dat mogelijk maken; anders per fiche expliciet
  melden dat de bijlage niet meekwam. Nooit stil weglaten.

Schrijven met `createFiche` (`lessons.js`), exporteren voor hergebruik.

### De poort
Spiegel de delete-flow, het veiligheidspatroon van dit project:

1. **Dry-run**: per fiche de nieuwe titel, doeltag, template, de opgeloste veldmapping, en
   waarschuwingen — onopgeloste doelen, weggelaten bijlagen, en **eigen fiches die deze titel al
   hebben** (duplicaatwaarschuwing).
2. Voettekst: `Terug` · `Kopieer 1 (test)` · `Kopieer alle (N)`. De test maakt er één en vraagt je
   die in Questi te controleren.
3. Uitvoeren met `runSequential` + `progressModal` (beide al aanwezig en geëxporteerd).
   **Voeg een annuleervlag toe aan `runSequential`** — die heeft nu geen afbreekmogelijkheid, en
   een volledige methode kan 200 fiches zijn à 150 ms in een modal zonder uitweg.
4. **Bonnetje**: JSON-download van wat er is aangemaakt (bron-id → nieuw id, waarschuwingen), in de
   vorm van `downloadFichesBackup`.
5. Zet de dirty-vlag zodat Questi's SPA herlaadt en de nieuwe fiches zichtbaar worden.

### Terug naar de tracker
Bewaar `copies: { "<methodeFicheId>": "<nieuwFicheId>" }` en `titlePrefix` op het methode-record in
`qwp_methodes_v1`. Na een volledige ronde: *"Deze methode volgen via je eigen fiches?"* → record
wordt `source:"tag"` met `order` = de nieuwe ids, `overrides` omgezet van oude naar nieuwe id.

Let op: kopieën hebben nog **geen `last_used_date`**, dus ze staan op open tot je ze echt geeft.
Dat klopt, maar zeg het in de bevestiging — anders lijkt het op verloren voortgang.

---

## Stap 4 — verificatie

1. Captures binnen en tak gekozen. Niet bouwen op een aanname.
2. `node --check` op elk aangeraakt bestand; CSS-haakjes in balans; de shared-bridge-check.
3. Kopieer **één** fiche naar een testtag. Open hem in Questi en vergelijk veld voor veld met de
   methodefiche: titel, doelen, concordantie, leerjaar. Noteer wat niet meekwam.
4. Herhaal dezelfde kopie → duplicaatwaarschuwing moet afgaan.
5. Kopieer 3–5 lessen, daarna een heel blok. Breek halverwege af: moet netjes stoppen en het
   bonnetje mag alleen bevatten wat echt is aangemaakt.
6. Accepteer de tracker-overname; voortgang en handmatige aanpassingen moeten de id-omzetting
   overleven.
7. Controleer dat de kopieën in de planner normaal koppelen — het zijn eigen fiches, dus via
   `postAttachment`, **niet** `postMethodAttachment`. Een kopie die nog als methode wordt gerouteerd
   faalt met 1235.
8. Ruim de testkopieën op met de bestaande beveiligde delete.
9. Breid de Zelftest uit met de vormen waar de feature op steunt.
10. `manifest.json` + `version.json` samen ophogen.

---

## Openstaande vragen (bijwerken zodra beantwoord)

- [ ] Leveren Camino / rekenroute überhaupt methodefiches? *(bepaalt tak A/B versus C)*
- [ ] Is een `type:"methods"`-veld schrijfbaar bij create? *(capture B)*
- [ ] Welk niveau uit de doelenboom verwacht `selected_goals` — het generieke doel of de
      leerlijn-bladeren?
- [ ] Heeft de nieuwe methodefiche dezelfde vorm als de ZILL-versie? *(capture A)*
- [ ] Wist `attachments: []` bij een PATCH bestaande bijlagen?
- [ ] Waar komt de schrijf-`attachmentId` vandaan?

## Verwijzingen

- `reference/questi-api-samples.md` — de captures, inclusief de methodefiche-route en de gotchas.
- `CLAUDE.md` — projectregels; `lessons.js` `probeMethodLesson` — de read-only probe.
- `lessons.js`: `runSequential`, `progressModal`, `createFiche`, `buildCreateBody`,
  `downloadFichesBackup`, `openDeleteModal` (het veiligheidspatroon), `openPicker`.
- `methodes.js`: `loadQuestiMethode`, `buildRows`, `blockRank` — waar de selectie-UI bij komt.
