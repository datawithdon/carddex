// Manual search: name + set / type / rarity filters over TCGdex, 30 per page.

import { getRarities, getSets, getTypes, searchCards } from "../api.js";
import { debounce, h, mount } from "../dom.js";
import { ownedIds } from "../store.js";
import { cardTile } from "../ui.js";

export async function render(root, params) {
  const q = h("input", { type: "search", placeholder: "Card name, e.g. Pikachu", value: params.get("q") || "", "aria-label": "Card name", maxlength: "60" });
  const set = h("select", { "aria-label": "Set" }, h("option", { value: "" }, "All sets"));
  const type = h("select", { "aria-label": "Type" }, h("option", { value: "" }, "All types"));
  const rarity = h("select", { "aria-label": "Rarity" }, h("option", { value: "" }, "All rarities"));
  const status = h("p", { class: "status", role: "status", "aria-live": "polite" });
  const grid = h("div", { class: "grid" });
  const more = h("button", { class: "btn hidden", type: "button" }, "Load more");
  let page = 1, run = 0;

  async function go(reset = true) {
    if (reset) { page = 1; grid.replaceChildren(); }
    const name = q.value.trim();
    if (!name && !set.value && !type.value && !rarity.value) { status.textContent = "Type a name or pick a filter."; more.classList.add("hidden"); return; }
    const mine = ++run;
    status.textContent = "Searching…";
    let cards;
    try {
      cards = await searchCards({ name, setId: set.value, type: type.value, rarity: rarity.value, page });
    } catch (e) {
      if (mine === run) status.textContent = e.message;
      return;
    }
    if (mine !== run) return;
    const owned = ownedIds();
    grid.append(...cards.map((c) => cardTile(c, { owned: owned.has(c.id) })));
    status.textContent = grid.children.length ? `${grid.children.length} cards` : "No cards found.";
    more.classList.toggle("hidden", cards.length < 30);
  }

  const goSoon = debounce(() => go(), 350);
  q.addEventListener("input", goSoon);
  for (const s of [set, type, rarity]) s.addEventListener("change", () => go());
  more.addEventListener("click", () => { page += 1; go(false); });

  mount(root, h("section", { class: "panel" },
    h("h1", {}, "Search cards"),
    h("div", { class: "filters" }, q, set, type, rarity),
    status, grid, more));

  Promise.all([getSets(), getTypes(), getRarities()]).then(([sets, types, rarities]) => {
    set.append(...sets.slice().reverse().map((s) => h("option", { value: s.id }, s.name)));
    type.append(...types.map((t) => h("option", { value: t }, t)));
    rarity.append(...rarities.map((r) => h("option", { value: r }, r)));
    if (params.get("set")) set.value = params.get("set");
  }).catch(() => {});
  q.focus();
  if (q.value) go();
}
