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

Op je Questi-agenda kan je de planner op drie manieren openen:

- Klik op de knop **"Weekplanner"** in de agenda-werkbalk (naast de zoom/Week/print-knoppen).
- Of druk op **Alt + P**.
- Of klik op het extensie-icoon in je browserwerkbalk.

Met dezelfde knop of **Alt + P** sluit je de planner weer (of via **Sluiten** linksonder).

---

## Gebruiken

1. **Kies je week.** Bovenaan links kies je *1 week* of *2 weken* en blader je met de pijlen.
2. **Zoek lesfiches.** Onderaan staan filterpanelen: kies een vak (bovenaan), verfijn met de
   sub-tags (blok 1, blok 2 …), of gebruik de zoekbalk. Je kan ook collega's lesfiches laden.
3. **Plan lesuren.**
   - **Sleep** een lesfiche vanuit een paneel op een leeg lesuur — de titel van het lesuur
     wordt meteen de titel van de fiche.
   - Of **klik** op een lesuur om handmatig een fiche te kiezen, het als gymles te markeren,
     of het **leeg te maken**.
   - Sleep een ingevuld lesuur naar een ander om het te **verplaatsen of te wisselen**.
   - Met **"Add selectie"** vul je meerdere gekozen fiches in één keer in.
4. **Vergist? Ctrl + Z** (of de knop **"Ongedaan maken"**) draait je laatste actie terug.
5. **Controleer.** Klik op **"Controleer wijzigingen"** voor een voor/na-overzicht
   (groen = gewijzigd, oranje = nog leeg, rood = overschrijft een bestaande fiche).
6. **Wegschrijven.** Pas na je goedkeuring wordt de knop **"Wegschrijven"** actief. Klik erop
   om alles naar Questi te schrijven. Tijdens het schrijven zie je een voortgangsbalk; daarna
   wordt de pagina automatisch vernieuwd zodat Questi je wijzigingen toont.

### Goed om te weten

- **Niets wordt geschreven** zonder dat jij op *Wegschrijven* klikt; tot dan blijft alles
  enkel in de planner staan.
- Wijzigingen gelden **enkel voor die ene week** (de andere weken van een herhalende reeks
  blijven ongemoeid).
- **Instellingen** (vast vak per lesuur) blijft bewaard en geldt voor elke week.
- Rood **gloeiende "Debug"-knop** = de extensie kon iets niet automatisch bepalen; klik erop
  voor een korte zelftest.

---

## Privacy

De extensie draait volledig in je eigen browser en praat enkel met `questi.com` via je eigen
login. Er worden geen gegevens naar derden gestuurd.
