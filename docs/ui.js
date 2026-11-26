// Gemeinsame Darstellung für Gast- und Admin-Seite: Reiter Herzhaft/Süß, Kategorien, Preis-Infos.
import { esc, variantsOf, VARIANTS, priceText, priceKnown } from "./api.js";

export const KINDS = { herzhaft: "Herzhaft", suess: "Süß" };

// Reiter: je Laden und Bereich (Herzhaft/Süß) mit Produkten. Bei nur einem Laden reichen „Herzhaft | Süß“.
export function productTabs(catalog) {
  const shops = catalog.shops.filter((s) => catalog.products.some((p) => p.shop === s.id));
  return shops.flatMap((s) => {
    const kinds = Object.keys(KINDS).filter((k) => catalog.products.some((p) => p.shop === s.id && p.kind === k));
    return kinds.map((k) => ({
      id: s.id + ":" + k, shop: s.id, kind: k,
      // mehrere Läden: „Paradiso Herzhaft | Paradiso Süß | Antipasti-Laden“
      label: shops.length > 1 ? (kinds.length > 1 ? `${s.name.replace(/^Café\s+/, "")} ${KINDS[k]}` : s.name) : KINDS[k],
    }));
  });
}
export const inTab = (tabId) => (p) => p.shop + ":" + p.kind === tabId;

export const catId = (c) => "cat-" + c.toLowerCase().replace(/[^a-z0-9]+/g, "-");
export const chipsHtml = (products) =>
  [...new Set(products.map((p) => p.category))].map((c) => `<a href="#${catId(c)}">${esc(c)}</a>`).join("");

export function sectionsHtml(products, cardFn) {
  if (!products.length) return `<div class="empty"><h3 class="serif">Kommt bald</h3>Hier kommen bald Produkte rein.</div>`;
  return [...new Set(products.map((p) => p.category))].map((c) => {
    const list = products.filter((p) => p.category === c);
    const both = list.some((p) => variantsOf(p).length > 1);
    const grams = list.some((p) => p.by_weight), pieces = list.some((p) => !p.by_weight);
    const note = grams ? (pieces ? "Menge in Gramm bzw. Stück" : "Menge in Gramm") : both ? "Als Mini oder in normaler Größe · Menge in Stück" : "Menge in Stück";
    return `<h2 class="cat-title" id="${catId(c)}">${esc(c)}</h2><p class="cat-note">${note}</p>
      <div class="grid">${list.map(cardFn).join("")}</div>`;
  }).join("");
}

// Kopfzeile einer Größe auf der Karte: links „Mini“/„Normal“, rechts der Preis („18 €/kg“, „ca. 3–6 €“, „Preis folgt“)
export function variantHead(p, v) {
  const left = variantsOf(p).length > 1 ? `<b>${VARIANTS[v]}</b>` : v === "mini" ? "nach Gewicht" : "";
  return `<div class="v-head"><span>${left}</span><span class="price${priceKnown(p, v) ? "" : " tbd"}">${priceText(p, v)}</span></div>`;
}

// Preisübersicht je Kategorie und Größe (aus den aktuellen Produktdaten)
function groupPrice(list, v) {
  const known = list.filter((p) => priceKnown(p, v));
  if (!known.length) return "Preis folgt";
  if (v === "mini") {
    const kg = [...new Set(known.map((p) => p.mini_price_kg))];
    return kg.length === 1 ? priceText(known[0], v) : `${priceText({ ...known[0], mini_price_kg: Math.min(...kg) }, v)} – ${priceText({ ...known[0], mini_price_kg: Math.max(...kg) }, v)}`;
  }
  const lo = Math.min(...known.map((p) => p.piece_price_min)), hi = Math.max(...known.map((p) => p.piece_price_max ?? p.piece_price_min));
  return priceText({ has_piece: true, piece_price_min: lo, piece_price_max: hi }, "stk") + " pro Stück";
}
export function priceNotesHtml(products) {
  const rows = [...new Set(products.map((p) => p.category))].map((c) => {
    const list = products.filter((p) => p.category === c && !p.coming_soon);
    const vs = ["mini", "stk"].filter((v) => list.some((p) => variantsOf(p).includes(v)));
    if (!vs.length) return "";
    const parts = vs.map((v) => `${vs.length > 1 ? VARIANTS[v] + " " : v === "mini" ? "nach Gewicht, " : ""}${groupPrice(list.filter((p) => variantsOf(p).includes(v)), v)}`);
    return `<li><b>${esc(c)}</b>: ${parts.join(" · ")}</li>`;
  }).join("");
  return `<ul class="price-notes">${rows}</ul>`;
}

// Infokasten: Notiz vom Gastgeber, Ablauf, Preise, wer dabei ist
export function infoHtml({ note, members, products, guest = true }) {
  const done = members.filter((m) => m.submitted).length;
  return `
    ${note ? `<div class="note">${esc(note).replace(/\n/g, "<br>")}</div>` : ""}
    <details class="info"${guest ? "" : " open"}>
      <summary><span>👥 ${members.length} dabei${members.length ? ` · ${done} abgeschickt` : ""}</span><span class="cat-note">Infos &amp; Preise</span></summary>
      <div class="info-body">
        ${members.length ? `<p class="members">${members.map((m) => `<span class="${m.submitted ? "ok" : ""}">${esc(m.name)}${m.submitted ? " ✓" : ""}</span>`).join("")}</p>` : `<p class="cat-note">Noch niemand eingetragen.</p>`}
        ${guest ? `<h4>So geht's</h4>
        <ol><li>Oben die Bestellung wählen (z. B. „Kaffee Heiligabend“).</li>
          <li>Produkte mit <b>+</b> auswählen – herzhaft und süß. Viele gibt es als <b>Mini</b> oder in <b>normaler Größe</b>.
            Du wählst einfach die Stückzahl – bei Minis bestellt der Gastgeber dann die passende Menge nach Gewicht.</li>
          <li>Unten auf <b>Abschicken</b> tippen. Ändern und erneut abschicken geht jederzeit, solange die Bestellung offen ist.</li></ol>` : ""}
        <h4>Preise (geschätzt)</h4>
        ${priceNotesHtml(products)}
        <p class="cat-note">Minis werden nach Gewicht (pro kg) berechnet, normale Teile pro Stück. Alle Preise sind ungefähre Angaben – „Preis folgt“ heißt: noch nicht bekannt, bestellen geht trotzdem.</p>
      </div>
    </details>`;
}
