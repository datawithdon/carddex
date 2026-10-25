// Wishlist with target prices. "Check prices" refreshes everything; cards at or
// below target are flagged as deals (and notified, if the user allowed it).

import { cardImg, h, money, mount, toast } from "../dom.js";
import { refreshPrices } from "../prices.js";
import { isDeal, save, state } from "../store.js";
import { openCard } from "../ui.js";

export function render(root) {
  const list = h("div", { class: "list" });
  const checkBtn = h("button", { class: "btn primary", type: "button" }, "Check prices");
  const note = h("p", { class: "muted small" });

  function draw() {
    note.textContent = state.lastPriceCheck ? `Last checked ${new Date(state.lastPriceCheck).toLocaleString()}` : "Prices not checked yet.";
    if (!state.wishlist.length) {
      mount(list, h("p", { class: "empty" }, "Your wishlist is empty. Open any card and choose “Add to wishlist”, or wishlist a set's missing cards from ", h("a", { href: "#/sets" }, "Sets"), "."));
      return;
    }
    const items = state.wishlist.slice().sort((a, b) => Number(isDeal(b)) - Number(isDeal(a)) || a.name.localeCompare(b.name));
    mount(list, items.map(row));
  }

  function row(w) {
    const target = h("input", { type: "number", min: "0", step: "0.01", value: w.target != null ? String(w.target) : "", placeholder: "Target", "aria-label": `Target price for ${w.name}`, class: "qty" });
    target.addEventListener("change", () => {
      const t = target.value === "" ? null : Number(target.value);
      w.target = Number.isFinite(t) && t >= 0 ? t : null;
      w.alerted = false;
      save(); draw();
    });
    const remove = h("button", { class: "icon-btn", type: "button", "aria-label": `Remove ${w.name} from wishlist`, onclick: () => {
      state.wishlist = state.wishlist.filter((x) => x !== w);
      save(); draw();
    } }, "×");
    const deal = isDeal(w);
    return h("div", { class: `item${deal ? " deal" : ""}` },
      h("button", { class: "thumb", type: "button", "aria-label": `Open ${w.name}`, onclick: () => openCard(w.cardId, draw) }, cardImg(w.image, w.name)),
      h("div", { class: "item-main" },
        h("strong", {}, w.name, deal ? h("span", { class: "badge good" }, "Deal") : null),
        h("span", { class: "muted small" }, [w.setName, w.number && `#${w.number}`].filter(Boolean).join(" · ")),
        w.lowestSeen != null ? h("span", { class: "muted small" }, `Lowest seen ${money(w.lowestSeen, w.currency)}`) : null),
      h("div", { class: "item-side" },
        h("span", { class: "price" }, money(w.price, w.currency)),
        h("div", { class: "row tight" }, target, remove)));
  }

  checkBtn.addEventListener("click", async () => {
    checkBtn.disabled = true;
    try {
      const r = await refreshPrices((d, t) => { checkBtn.textContent = `Checking ${d}/${t}…`; });
      toast(r.newDeals.length ? `${r.newDeals.length} card(s) hit your target price!` : "Prices updated. No new deals.");
    } catch (e) { toast(e.message); }
    checkBtn.disabled = false;
    checkBtn.textContent = "Check prices";
    draw();
  });

  mount(root, h("section", { class: "panel" },
    h("div", { class: "head" }, h("h1", {}, "Wishlist"), checkBtn),
    h("p", { class: "muted" }, "Set a target price and CardDex flags the card when the market price drops to it. Prices are re-checked automatically when you open the app (every 6 hours at most)."),
    note, list));
  draw();
}
