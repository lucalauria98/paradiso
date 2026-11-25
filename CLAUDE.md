# Projektkontext: Paradiso Bestellseite

## Ziel
Gemeinsame Bestellung beim Café Paradiso (italienische Bäckerei, Solingen-Ohligs).
1. Testfall: Weihnachtsdinner mit ~20 Familienmitgliedern – jeder wählt selbst aus.
2. Langfristig: dem Chef als Bestellsystem zeigen, evtl. dauerhaft einrichten.
Später kommt ein zweiter Laden dazu (nur Antipasti) – Tab existiert schon, Produkte fehlen.

## Stand (Prototyp fertig, läuft im Demo-Modus)
- Frontend: reines HTML/CSS/JS ohne Build in `docs/` → GitHub Pages (Ordner /docs)
- Backend: Supabase (Postgres, Auth, Realtime, RLS). `docs/config.js` ist noch leer = Demo-Modus (localStorage)
- `docs/index.html` + `guest.js`: Gast öffnet `?e=<invite_code>`, gibt Namen ein, wählt Produkte (+/−), Autosave. Sieht KEINE Preise und nichts von anderen.
- `docs/admin.html` + `admin.js`: Login (E-Mail/Passwort), Bestellung anlegen, Einladungslink/WhatsApp, Live-Übersicht nach Produkt/Person, geschätzte Kosten, Gewicht Minis, Bestellliste kopieren, Bestellung schließen.
- `docs/api.js`: Datenschicht (Supabase oder Demo, gleiche Schnittstelle) + Preisberechnung
- `docs/catalog.json`: 53 Produkte (Quelle der Wahrheit) → `python3 tools/gen_seed.py` erzeugt `supabase/seed.sql`
- `supabase/schema.sql`: Tabellen shops, products, events, participants, order_items; RLS; Gäste nur über security-definer-RPCs `guest_event/guest_join/guest_items/guest_set_item` (id + secret). Lokal mit Postgres getestet.
- Bilder: `docs/img/paradiso/*.jpg` (aus Thekenfotos zugeschnitten, Platzhalterqualität)

## Preise (Schätzungen, Chef konnte keine genauen nennen)
- Alle Minis (herzhaft + süß): 18 €/kg. Stückgewicht geschätzt: herzhaft 45 g, süß 30 g, Kekse 12 g
- Cornetti/Teilchen (nicht Mini): ca. 3–6 €/Stück
- Kosten sieht nur der Admin

## Offene Punkte
- Supabase live schalten (Schema + Seed ausführen, Admin-User anlegen, Signups aus, config.js füllen), GitHub-Repo + Pages
- Arancini & Calzone: noch kein Bild (coming_soon)
- Namen klären: V1-2.9 (frittiertes Teil), C-1.3 (Gebäck-Muschel)
- 9 weitere Süß-Fotos in `Bilder_Süßkram/IMG_2821–2829` noch nicht eingearbeitet
- Antipasti-Laden: Bilder nach `docs/img/antipasti/`, Einträge mit `"shop":"antipasti"` in catalog.json
- Später für den Chef: echte Namen/Preise, Produktfotos aus Fotobox, Abholtermin pro Bestellung

## Vorgaben
- Datenschutz & Open Source wichtig, keine unnötigen Drittanbieter
- Einfach halten (kein Framework/Build), mobil zuerst, Deutsch
- Rohdaten (Bilder_*, PDF, MOV) sind per .gitignore ausgeschlossen
