# Paradiso Bestellseite

Gemeinsame Bestellung für Familie/Gruppen beim Café Paradiso (später auch Antipasti-Laden).
Ein **Projekt** (z. B. „Weihnachten 2026“) hat einen Einladungslink und mehrere **Bestellungen**
(z. B. „Kaffee Heiligabend“, mit Abholtermin). Gäste tragen sich einmal ein, wählen pro Bestellung aus
(Herzhaft/Süß) und **schicken ab** – erneutes Abschicken aktualisiert. Der Admin sieht Gesamtliste, Kosten und
einen **Verlauf** aller Änderungen live und pflegt Produkte, Fotos und Preise direkt im Browser.

- **Frontend:** reines HTML/CSS/JS in `docs/` (kein Build), läuft auf GitHub Pages
- **Backend:** Supabase (Postgres + Auth + Realtime), Rechte per Row Level Security
- **Demo-Modus:** Ist `docs/config.js` leer, läuft alles lokal im Browser – zum Vorzeigen ohne Setup

```
docs/
  index.html  guest.js   Gäste: Name eingeben, pro Bestellung auswählen, abschicken
  admin.html  admin.js   Admin: Projekte, Bestellungen + Abholtermin, Live-Übersicht, Verlauf, Produkte & Preise
  api.js                 Datenschicht (Supabase oder Demo) + Preisberechnung
  ui.js                  Gemeinsame Produktansicht (Herzhaft/Süß, Preis-Infos) für Gast + Admin
  config.js              Supabase-URL + anon key
  catalog.json           Produktkatalog (Quelle für seed.sql und Demo)
  img/paradiso/          Produktbilder
supabase/
  schema.sql             Tabellen, RLS, Gast-Funktionen, Bilder-Speicher, Realtime
  seed.sql               Erstbefüllung der Produkte (generiert aus catalog.json)
tools/gen_seed.py        catalog.json → seed.sql
```

## Lokal testen (Demo)

```bash
cd docs && python3 -m http.server 8000
```
- Gäste: http://localhost:8000/index.html?e=demo
- Admin: http://localhost:8000/admin.html

## Live schalten

### 1. Supabase
1. Projekt anlegen auf supabase.com (Region: Frankfurt `eu-central-1`).
2. **SQL Editor** → `supabase/schema.sql` einfügen → Run. Danach `supabase/seed.sql` → Run.
3. **Authentication → Users → Add user**: deine E-Mail + Passwort, „Auto Confirm User" an. Das ist der Admin-Login.
4. Optional, aber empfohlen: **Authentication → Sign In / Providers → „Allow new users to sign up" aus**, damit sich niemand sonst einen Admin-Account anlegt.
5. **Project Settings → API**: `Project URL` und `anon public` Key in `docs/config.js` eintragen.
   (Der anon key ist öffentlich gedacht – die Rechte regelt RLS. Den `service_role` Key **nie** ins Frontend!)

### 2. GitHub Pages
1. Repo anlegen und pushen (die Rohfotos/Videos sind per `.gitignore` ausgeschlossen).
2. Repo → **Settings → Pages** → Source: „Deploy from a branch", Branch `main`, Ordner **`/docs`**.
3. Nach ~1 Min erreichbar unter `https://<user>.github.io/<repo>/admin.html`.
   Hinweis: Für GitHub Pages im Free-Plan muss das Repo öffentlich sein (Code + Bilder sichtbar, Bestelldaten nicht – die liegen in Supabase).

### 3. Benutzen
1. `admin.html` öffnen → einloggen → „+ Neues Projekt" (z. B. „Weihnachten 2026").
2. „+ Neue Bestellung" je Termin, z. B. „Kaffee Heiligabend“ mit Abholtermin 24.12., 10:00.
3. Einladungslink (einer pro Projekt) kopieren oder per WhatsApp-Button an die Familie schicken.
4. Gäste tragen einmal ihren Namen ein, wählen pro Bestellung aus und tippen auf **Abschicken** – du bekommst eine
   Live-Meldung und siehst alles je Bestellung oder „Gesamt“, inkl. Verlauf („Cornetto 2 → 3“).
5. Pro Bestellung: „Bestellung schließen" → „Bestellliste kopieren" (mit Abholtermin) und an den Laden schicken.
   Die anderen Bestellungen des Projekts bleiben offen.

## Wer sieht was?
| | Gast (mit Link) | Admin (eingeloggt) |
|---|---|---|
| Produkte + geschätzte Preise pro Stück | ✓ | ✓ |
| Notiz des Gastgebers | ✓ | ✓ (schreibt sie) |
| Wer dabei ist / abgeschickt hat (nur Namen) | ✓ | ✓ |
| Eigene Auswahl ändern + abschicken | ✓ (solange die Bestellung offen ist) | – |
| Auswahl anderer Gäste | ✗ | ✓ |
| Gesamtliste, Kosten, Verlauf | ✗ | ✓ |
| Produkte, Fotos, Preise bearbeiten | ✗ | ✓ |

Gäste greifen nie direkt auf Tabellen zu, nur über die Funktionen `guest_*` (geprüft per geheimer Gast-ID im Browser).

> **Supabase Free-Plan:** Projekte ohne Aktivität werden nach ca. 1 Woche pausiert. Vor dem Verschicken eines
> Einladungslinks kurz die Admin-Seite öffnen bzw. im Dashboard prüfen, ob das Projekt aktiv ist („Restore“).

## Produkte & Preise pflegen
- **Im Admin:** Reiter „Produkte & Preise“ → Produkt antippen → Name, Foto, Preis, Gewicht, Kategorie,
  Herzhaft/Süß, Status (Bestellbar / Bald dabei / Ausgeblendet). Gilt sofort für alle. Fotos landen im
  Supabase-Storage (Bucket `produktbilder`) und werden vorher verkleinert.
- **Supabase ist ab jetzt die Quelle der Wahrheit** für Produkte. `catalog.json` dient nur noch dem Demo-Modus
  und der Erstbefüllung; `seed.sql` legt nur fehlende Produkte an und überschreibt keine Änderungen aus dem Admin.
  (`python3 tools/gen_seed.py --overwrite` erzeugt bei Bedarf eine Version, die alles überschreibt.)
- **Zwei Größen pro Produkt:** *Mini* (nach Gewicht, €/kg + geschätztes Stückgewicht) und/oder *Normal* (pro Stück, Spanne
  von–bis). Gäste wählen die Menge je Größe; Bestellliste und Kosten trennen „Calzone (Mini)“ und „Calzone“.
- Preise sind aktuell Schätzungen: Minis **18 €/kg** (Stückgewicht: herzhaft 45 g, süß 30 g, Kekse 12 g);
  normale Größe **3–6 €/Stück** (Herzhaftes, Cannoli/Törtchen, Cornetti). Kekse nur nach Gewicht.

## Antipasti-Laden ergänzen
Im Admin „+ Neues Produkt“ → Laden „Antipasti-Laden“ wählen. Sobald dort ein Produkt existiert, erscheint für Gäste ein eigener Reiter.

## Offen
- Echte Produktnamen + Preise mit dem Chef klären, Fotos aus der Fotobox
- Arancini & Calzone: Bild fehlt (als „Bild folgt" markiert)
- `frittiert` (V1-2.9) und Gebäck-Muschel (C-1.3): Namen klären
- Weitere Süß-Fotos (IMG_2821–2829) noch nicht eingearbeitet
