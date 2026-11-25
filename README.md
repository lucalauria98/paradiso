# Paradiso Bestellseite

Gemeinsame Bestellung für Familie/Gruppen beim Café Paradiso (später auch Antipasti-Laden).
Gäste wählen per Einladungslink aus, nur der Admin sieht Gesamtliste und Kosten – live.

- **Frontend:** reines HTML/CSS/JS in `docs/` (kein Build), läuft auf GitHub Pages
- **Backend:** Supabase (Postgres + Auth + Realtime), Rechte per Row Level Security
- **Demo-Modus:** Ist `docs/config.js` leer, läuft alles lokal im Browser – zum Vorzeigen ohne Setup

```
docs/
  index.html  guest.js   Gäste: Name eingeben, Produkte wählen
  admin.html  admin.js   Admin: Login, Einladungslink, Live-Übersicht, Kosten, Bestellliste
  api.js                 Datenschicht (Supabase oder Demo) + Preisberechnung
  config.js              Supabase-URL + anon key
  catalog.json           Produktkatalog (Quelle für seed.sql und Demo)
  img/paradiso/          Produktbilder
supabase/
  schema.sql             Tabellen, RLS, Gast-Funktionen, Realtime
  seed.sql               Produkte (generiert aus catalog.json)
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
1. `admin.html` öffnen → einloggen → „+ Neue Bestellung" (z. B. „Weihnachten 2026").
2. Einladungslink kopieren oder per WhatsApp-Button an die Familie schicken.
3. Gäste tragen ihren Namen ein und wählen aus – du siehst alles live.
4. Zum Schluss „Bestellung schließen" → „Bestellliste kopieren" und an den Laden schicken.

## Wer sieht was?
| | Gast (mit Link) | Admin (eingeloggt) |
|---|---|---|
| Produkte | ✓ | ✓ |
| Eigene Auswahl ändern | ✓ (solange offen) | – |
| Auswahl anderer Gäste | ✗ | ✓ |
| Kosten / Gesamtliste | ✗ | ✓ |

Gäste greifen nie direkt auf Tabellen zu, nur über die Funktionen `guest_*` (geprüft per geheimer Gast-ID im Browser).

## Produkte & Preise pflegen
- **Schnell:** Supabase → Table Editor → `products` (Name, Preis, Gewicht, `active`, `coming_soon`).
- **Im Code:** `docs/catalog.json` ändern → `python3 tools/gen_seed.py` → `supabase/seed.sql` erneut ausführen.
- Preise sind aktuell Schätzungen: Minis **18 €/kg** (Stückgewicht geschätzt: herzhaft 45 g, süß 30 g, Kekse 12 g), Cornetti/Teilchen **3–6 €/Stück**.

## Antipasti-Laden ergänzen
Bilder nach `docs/img/antipasti/`, Einträge mit `"shop": "antipasti"` in `catalog.json`, dann Seed neu ausführen. Der Tab ist schon da.

## Offen
- Echte Produktnamen + Preise mit dem Chef klären, Fotos aus der Fotobox
- Arancini & Calzone: Bild fehlt (als „Bild folgt" markiert)
- `frittiert` (V1-2.9) und Gebäck-Muschel (C-1.3): Namen klären
- Weitere Süß-Fotos (IMG_2821–2829) noch nicht eingearbeitet
