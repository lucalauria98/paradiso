# Projektkontext: Paradiso Bestellseite

## Ziel
Gemeinsame Bestellung beim Café Paradiso (italienische Bäckerei, Solingen-Ohligs).
1. Testfall: Weihnachtsdinner mit ~20 Familienmitgliedern – jeder wählt selbst aus.
2. Langfristig: dem Chef als Bestellsystem zeigen, evtl. dauerhaft einrichten.
Später kommt ein zweiter Laden dazu (nur Antipasti) – Tab existiert schon, Produkte fehlen.

## Stand (live seit 2026-11-25)
- Live: https://lucalauria98.github.io/paradiso/admin.html · Repo `lucalauria98/paradiso` (öffentlich, Pages aus `/docs`)
- Supabase-Projekt `paradiso` (eigene Organization, Frankfurt), Signups aus, ein Admin-User
- Frontend: reines HTML/CSS/JS ohne Build in `docs/` → GitHub Pages (Ordner /docs)
- Backend: Supabase (Postgres, Auth, Realtime, RLS). `docs/config.js` enthält URL + Publishable Key (leer = Demo-Modus mit localStorage)
- Aufbau: **Projekt** (z. B. Weihnachten 2026, ein Einladungslink) → mehrere **Bestellungen** (Titel + Abholtermin, einzeln schließbar). Gäste tragen sich einmal pro Projekt ein, Auswahl je Bestellung.
- `docs/index.html` + `guest.js`: Gast öffnet `?e=<invite_code>`, gibt Namen ein, wählt pro Bestellung (Reiter) Produkte in Reitern Herzhaft/Süß. Auswahl = Entwurf (localStorage) bis „Abschicken“; erneutes Abschicken aktualisiert. Sieht „ca.“-Preise pro Stück, Notiz des Gastgebers, wer dabei ist/abgeschickt hat (nur Namen) – nie die Auswahl anderer.
- `docs/admin.html` + `admin.js`: Login, Projekte (+ Notiz für Gäste), Bestellungen anlegen/bearbeiten/löschen/schließen, Einladungslink/WhatsApp/Gast-Ansicht, Live-Übersicht je Bestellung oder „Gesamt“ nach Produkt/Person/Verlauf, Live-Meldung bei neuem Abschicken, Bestellliste kopieren. Bereich „Produkte & Preise“: gleiche Ansicht wie Gäste, Editor pro Produkt inkl. Foto-Upload (Supabase Storage `produktbilder`).
- `docs/ui.js`: gemeinsame Produktansicht (Reiter Herzhaft/Süß, Kategorien, Preis-Infos, Infokasten)
- `docs/api.js`: Datenschicht (Supabase oder Demo, gleiche Schnittstelle) + Preisberechnung
- Produkte: **Supabase ist Quelle der Wahrheit** (Admin-Editor). `docs/catalog.json` (53 Produkte, Feld `kind` herzhaft/suess) nur für Demo + Erstbefüllung; `tools/gen_seed.py` → `seed.sql` legt nur Fehlendes an (`--overwrite` überschreibt)
- `supabase/schema.sql`: Tabellen admins, shops, products, projects, orders, participants, order_items, submissions (Verlauf); explizite GRANTs + RLS; Produkte/Bilder nur für `is_admin()`; Gäste nur über security-definer-RPCs `guest_project/guest_join/guest_items/guest_submit` (id + secret). Syntax lässt sich mit `pglast` prüfen (kein lokales Postgres).
- Bilder: `docs/img/paradiso/*.jpg` (aus Thekenfotos zugeschnitten, Platzhalterqualität)

## Preise & Größen (Chef konnte keine genauen nennen)
- Zwei Größen: **Mini** = nach Gewicht (€/kg), **Normal** = pro Stück (NICHT proportional zum kg-Preis, z. B. Calzone ~5,50 €)
- Bekannt: herzhafte Minis 18 €/kg, herzhaft normal ca. 3–6 €. Alles Süße (Minis, Kekse, normale Teile, Cornetti): „Preis folgt“
- Gäste sehen KEINE Cent-Schätzungen pro Mini-Stück (Nutzer: „irritiert nur“) – nur €/kg bzw. €/Stück oder „Preis folgt“
- Gäste wählen Größe + Stückzahl; Admin legt pro Bestellung die Bestellmenge fest (Minis in Gramm, Vorschlag = Wünsche × Stückgewicht auf 100 g aufgerundet; optional gemischt je Kategorie; Endbetrag laut Bon)
- Vegetarisch: products.veggie → 🌱-Label + Filter „Nur vegetarisch“ für Gäste. Unklare Produkte (Teigtaschen, Brötchen, Pizza-Brioche, Frittiertes, Arancini, Calzone) gibt es doppelt: „– vegetarisch“ (id) und „– mit Fleisch“ (id-fleisch). Arancini veggie = Spinat.
- Anmerkungen: Gäste schreiben pro Bestellung eine Notiz (order_notes); Admin hakt „an Laden weitergeben“ an → erscheint als „Hinweise“ in der Bestellliste. Änderung durch Gast setzt den Haken zurück.
- DB: products.has_mini/has_piece (Größe gibt es) + mini_price_kg/mini_weight_g/piece_price_min/max (null = Preis folgt); order_items.variant 'mini'|'stk'; order_plan (Admin-Mengen); orders.mini_mix/final_amount

## Offene Punkte
- Optik überarbeiten (Paradiso-Website als Vorlage, Link kommt vom Nutzer)
- Supabase Free-Plan pausiert nach ~1 Woche Inaktivität → vor Einsatz prüfen
- Arancini & Calzone: bestellbar, aber noch ohne Foto (Nutzer reicht eins nach → im Admin hochladen)
- Namen klären: V1-2.9 (frittiertes Teil), C-1.3 (Gebäck-Muschel)
- 9 weitere Süß-Fotos in `Bilder_Süßkram/IMG_2821–2829` noch nicht eingearbeitet
- Antipasti-Laden: Bilder nach `docs/img/antipasti/`, Einträge mit `"shop":"antipasti"` in catalog.json
- Später für den Chef: echte Namen/Preise, Produktfotos aus Fotobox, Abholtermin pro Bestellung

## Vorgaben
- Datenschutz & Open Source wichtig, keine unnötigen Drittanbieter
- Einfach halten (kein Framework/Build), mobil zuerst, Deutsch
- Rohdaten (Bilder_*, PDF, MOV) sind per .gitignore ausgeschlossen
