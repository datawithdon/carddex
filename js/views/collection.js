// Collection: value summary, filter/sort, qty and condition editing, price refresh, CSV/JSON export.

import { cardImg, download, h, money, mount, num, toast } from "../dom.js";
import { toCsv } from "../match.js";
import { refreshPrices } from "../prices.js";
import { CONDITIONS, collectionValue, save, state } from "../store.js";
import { openCard } from "../ui.js";

const SORTS = {
  value: (a, b) => (b.price ?? -1) * b.qty - (a.price ?? -1) * a.qty,
  name: (a, b) => a.name.localeCompare(b.name),
  set: (a, b) => a.setName.localeCompare(b.setName) || a.number.localeCompare(b.number, undefined, { numeric: true }),
  added: (a, b) => b.addedAt.localeCompare(a.addedAt),
};

export function render(root) {
  const filter = h("input", { type: "search", placeholder: "Filter by name, set or rarity", "aria-label": "Filter collection" });
  const sort = h("select", { "aria-label": "Sort" },
    h("option", { value: "value" }, "Highest value"), h("option", { value: "name" }, "Name"),
    h("option", { value: "set" }, "Set & number"), h("option", { value: "added" }, "Recently added"));
  const summary = h("div", { class: "tiles" });
  const list = h("div", { class: "list" });
  const refreshBtn = h("button", { class: "btn", type: "button" }, "Refresh prices");

  function draw() {
    const v = collectionValue();
    mount(summary,
      stat("Cards", num(v.cards)), stat("Unique", num(v.unique)),
      stat("Value (USD)", money(v.totals.USD, "USD")),
      v.totals.EUR ? stat("Value (EUR)", money(v.totals.EUR, "EUR")) : null,
      stat("Priced", v.cards ? `${Math.round((v.priced / v.cards) * 100)}%` : "—"));
    const f = filter.value.trim().toLowerCase();
    const items = state.collection.filter((i) => !f || `${i.name} ${i.setName} ${i.rarity}`.toLowerCase().includes(f)).sort(SORTS[sort.value]);
    if (!state.collection.length) {
      mount(list, h("p", { class: "empty" }, "Your collection is empty. ", h("a", { href: "#/scan" }, "Scan a card"), " or ", h("a", { href: "#/search" }, "search"), " to add one."));
      return;
    }
    mount(list, items.length ? items.map(row) : h("p", { class: "empty" }, "No cards match."));
  }

  function row(i) {
    const qty = h("input", { type: "number", min: "0", max: "9999", value: String(i.qty), "aria-label": `Quantity of ${i.name}`, class: "qty" });
    qty.addEventListener("change", () => {
      const n = Math.floor(Number(qty.value));
      if (n <= 0) {
        if (!confirm(`Remove ${i.name} from your collection?`)) { qty.value = String(i.qty); return; }
        state.collection = state.collection.filter((x) => x !== i);
      } else i.qty = Math.min(9999, n);
      save(); draw();
    });
    const cond = h("select", { "aria-label": `Condition of ${i.name}` }, CONDITIONS.map((c) => h("option", { value: c, selected: c === i.condition }, c)));
    cond.addEventListener("change", () => { i.condition = cond.value; save(); });
    return h("div", { class: "item" },
      h("button", { class: "thumb", type: "button", "aria-label": `Open ${i.name}`, onclick: () => openCard(i.cardId, draw) }, cardImg(i.image, i.name)),
      h("div", { class: "item-main" },
        h("strong", {}, i.name),
        h("span", { class: "muted small" }, [i.setName, i.number && `#${i.number}`, i.rarity].filter(Boolean).join(" · ")),
        i.paid != null && i.price != null ? h("span", { class: `small ${i.price >= i.paid ? "up" : "down"}` }, `Paid ${money(i.paid, i.currency)} → ${i.price >= i.paid ? "+" : ""}${money(i.price - i.paid, i.currency)}`) : null),
      h("div", { class: "item-side" },
        h("span", { class: "price" }, money(i.price, i.currency)),
        i.qty > 1 && i.price != null ? h("span", { class: "muted small" }, `× ${i.qty} = ${money(i.price * i.qty, i.currency)}`) : null,
        h("div", { class: "row tight" }, qty, cond)));
  }

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      const r = await refreshPrices((d, t) => { refreshBtn.textContent = `Updating ${d}/${t}…`; });
      toast(`Prices updated for ${r.updated} cards${r.failed ? ` (${r.failed} failed)` : ""}`);
    } catch (e) { toast(e.message); }
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh prices";
    draw();
  });

  const exportCsv = () => {
    const rows = [["Name", "Set", "Number", "Rarity", "Condition", "Qty", "Unit price", "Currency", "Total", "Paid", "Card ID", "Price updated"]];
    for (const i of state.collection) rows.push([i.name, i.setName, i.number, i.rarity, i.condition, i.qty, i.price ?? "", i.currency, i.price != null ? (i.price * i.qty).toFixed(2) : "", i.paid ?? "", i.cardId, i.priceUpdated || ""]);
    download(`carddex-collection-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), "text/csv");
  };

  filter.addEventListener("input", draw);
  sort.addEventListener("change", draw);
  mount(root, h("section", { class: "panel" },
    h("div", { class: "head" }, h("h1", {}, "Collection"),
      h("div", { class: "row" }, refreshBtn, h("button", { class: "btn", type: "button", onclick: exportCsv, disabled: !state.collection.length }, "Export CSV"))),
    summary, h("div", { class: "filters" }, filter, sort), list));
  draw();
}

const stat = (label, value) => h("div", { class: "stat" }, h("span", { class: "stat-label" }, label), h("span", { class: "stat-value" }, value));
