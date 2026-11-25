// Gemeinsame Darstellung für Gast- und Admin-Seite: Reiter Herzhaft/Süß, Kategorien, Preis-Infos.
import { esc, fmtEur, pieceCost, variantsOf, VARIANTS } from "./api.js";

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
    const both = list.some((p) => variantsOf(p).length > 1);
    const note = both ? "Als Mini oder in normaler Größe · Menge in Stück" : "Menge in Stück";
    return `<h2 class="cat-title" id="${catId(c)}">${esc(c)}</h2><p class="cat-note">${note}</p>
      <div class="grid">${list.map(cardFn).join("")}</div>`;
  }).join("");
}

// Spanne [lo, hi] als kurzer Text: „0,81 €“, „0,54 – 0,81 €“ oder „3–6 €“
function span(lo, hi) {
  if (Math.abs(lo - hi) < 0.005) return fmtEur(lo);
  return hi < 1.5 ? `${fmtEur(lo).replace(/\s?€/, "")} – ${fmtEur(hi)}` : `${+lo.toFixed(2)}–${+hi.toFixed(2)} €`.replace(/\./g, ",");
}
// Preis pro Stück in einer Größe, z. B. „ca. 0,81 €“ oder „ca. 3–6 €“
export function piecePrice(p, v) {
  const [a, b] = pieceCost(p, v);
  return a || b ? "ca. " + span(a, b) : "";
}

// Kopfzeile einer Größe auf der Karte: links „Mini · 18 €/kg“ bzw. „Normal“, rechts der Stückpreis
export function variantHead(p, v) {
  const both = variantsOf(p).length > 1;
  const left = v === "mini"
    ? `${both ? "<b>Mini</b> · " : ""}${fmtEur(p.mini_price_kg).replace(",00", "")}/kg`
    : both ? "<b>Normal</b>" : "";
  const right = v === "mini" ? "≈ " + span(...pieceCost(p, v)) : piecePrice(p, v);
  return `<div class="v-head"><span>${left}</span><span class="price">${right}</span></div>`;
}

// Preisübersicht je Kategorie und Größe (aus den aktuellen Produktdaten berechnet)
export function priceNotesHtml(products) {
  const rows = [...new Set(products.map((p) => p.category))].map((c) => {
    const list = products.filter((p) => p.category === c && !p.coming_soon);
    const vs = ["mini", "stk"].filter((v) => list.some((p) => variantsOf(p).includes(v)));
    if (!vs.length) return "";
    const parts = vs.map((v) => {
      const costs = list.filter((p) => variantsOf(p).includes(v)).map((p) => pieceCost(p, v));
      const txt = "ca. " + span(Math.min(...costs.map((x) => x[0])), Math.max(...costs.map((x) => x[1])));
      const kg = v === "mini" ? [...new Set(list.filter((p) => p.mini_price_kg).map((p) => p.mini_price_kg))] : [];
      return `${vs.length > 1 ? VARIANTS[v] + " " : ""}${txt}${kg.length === 1 ? ` <span class="cat-note">(${fmtEur(kg[0])}/kg)</span>` : ""}`;
    });
    return `<li><b>${esc(c)}</b>: ${parts.join(" · ")} pro Stück</li>`;
  }).join("");
  return `<ul class="price-notes">${rows}</ul>`;
}

function miniNote(products) {
  const kg = [...new Set(products.filter((p) => p.mini_price_kg != null).map((p) => p.mini_price_kg))];
  return kg.length === 1 ? `Minis kosten ${fmtEur(kg[0])}/kg, der Preis pro Stück ist daraus geschätzt.` : kg.length ? "Minis werden nach Gewicht berechnet." : "";
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
        <p class="cat-note">${miniNote(products)} Normale Teile werden pro Stück berechnet. Alle Preise sind Schätzungen.</p>
      </div>
    </details>`;
}
