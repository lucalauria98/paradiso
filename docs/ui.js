// Gemeinsame Darstellung für Gast- und Admin-Seite: Reiter Herzhaft/Süß, Kategorien, Preis-Infos.
import { esc, fmtEur, pieceCost } from "./api.js";

export const KINDS = { herzhaft: "Herzhaft", suess: "Süß" };

// Reiter: je Laden und Bereich (Herzhaft/Süß) mit Produkten. Bei nur einem Laden reichen „Herzhaft | Süß“.
export function productTabs(catalog) {
  const shops = catalog.shops.filter((s) => catalog.products.some((p) => p.shop === s.id));
  return shops.flatMap((s) => {
    const kinds = Object.keys(KINDS).filter((k) => catalog.products.some((p) => p.shop === s.id && p.kind === k));
    return kinds.map((k) => ({
      id: s.id + ":" + k, shop: s.id, kind: k,
      label: shops.length > 1 ? (kinds.length > 1 ? `${s.name} · ${KINDS[k]}` : s.name) : KINDS[k],
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
    const note = list.every((p) => p.unit === "kg") ? "Mini-Größe · Menge in Stück" : "Menge in Stück";
    return `<h2 class="cat-title" id="${catId(c)}">${esc(c)}</h2><p class="cat-note">${note}</p>
      <div class="grid">${list.map(cardFn).join("")}</div>`;
  }).join("");
}

const cents = (n) => fmtEur(n).replace(/\s?€/, " €");
// Preis pro Stück, z. B. „ca. 0,81 €“ oder „ca. 3–6 €“
export function piecePrice(p) {
  const [a, b] = pieceCost(p);
  if (!a && !b) return "";
  return Math.abs(a - b) < 0.005 ? `ca. ${cents(a)}` : `ca. ${Math.round(a)}–${Math.round(b)} €`;
}

// Preisübersicht je Kategorie (aus den aktuellen Produktdaten berechnet)
export function priceNotesHtml(products) {
  const rows = [...new Set(products.map((p) => p.category))].map((c) => {
    const list = products.filter((p) => p.category === c && !p.coming_soon);
    if (!list.length) return "";
    const costs = list.map(pieceCost);
    const lo = Math.min(...costs.map((x) => x[0])), hi = Math.max(...costs.map((x) => x[1]));
    const kg = [...new Set(list.filter((p) => p.unit === "kg").map((p) => p.price_min))];
    const per = Math.abs(lo - hi) < 0.005 ? cents(lo)
      : hi < 1.5 ? `${cents(lo)} – ${cents(hi)}` : `${Math.round(lo)}–${Math.round(hi)} €`;
    return `<li><b>${esc(c)}</b>: ca. ${per} pro Stück${kg.length === 1 ? ` <span class="cat-note">(${fmtEur(kg[0])}/kg)</span>` : ""}</li>`;
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
          <li>Produkte mit <b>+</b> auswählen – herzhaft und süß.</li>
          <li>Unten auf <b>Abschicken</b> tippen. Ändern und erneut abschicken geht jederzeit, solange die Bestellung offen ist.</li></ol>` : ""}
        <h4>Preise (geschätzt)</h4>
        ${priceNotesHtml(products)}
        <p class="cat-note">Die Minis werden nach Gewicht berechnet – die Preise pro Stück sind daher Schätzungen.</p>
      </div>
    </details>`;
}
