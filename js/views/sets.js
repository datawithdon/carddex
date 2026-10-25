// Set completion: progress per set you own cards from, and a per-set checklist
// with missing cards (which can be sent to the wishlist in one go).

import { getSet, getSets } from "../api.js";
import { cardImg, h, mount, toast } from "../dom.js";
import { addToWishlist, ownedIds, state } from "../store.js";
import { cardTile } from "../ui.js";

export async function render(root, params, setId) {
  if (setId) return renderSet(root, setId);
  mount(root, h("section", { class: "panel" }, h("h1", {}, "Set completion"), h("p", { class: "empty" }, "Loading sets…")));
  let sets = [];
  try { sets = await getSets(); } catch (e) { mount(root, h("section", { class: "panel" }, h("h1", {}, "Set completion"), h("p", { class: "error" }, e.message))); return; }
  const byId = new Map(sets.map((s) => [s.id, s]));

  const groups = new Map();
  for (const i of state.collection) {
    if (!i.setId) continue;
    if (!groups.has(i.setId)) groups.set(i.setId, { id: i.setId, name: i.setName, ids: new Set() });
    groups.get(i.setId).ids.add(i.cardId);
  }
  const rows = [...groups.values()].map((g) => {
    const s = byId.get(g.id);
    const total = s?.official || s?.total || 0;
    return { ...g, name: s?.name || g.name, logo: s?.logo || "", total, have: g.ids.size, pct: total ? Math.min(1, g.ids.size / total) : 0 };
  }).sort((a, b) => b.pct - a.pct);

  mount(root, h("section", { class: "panel" },
    h("h1", {}, "Set completion"),
    rows.length
      ? h("div", { class: "sets" }, rows.map((r) => h("a", { class: "set-row", href: `#/sets/${encodeURIComponent(r.id)}` },
        r.logo ? h("img", { class: "set-logo", src: `${r.logo}.webp`, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : h("span", { class: "set-logo" }),
        h("div", { class: "set-main" },
          h("strong", {}, r.name),
          progress(r.pct),
          h("span", { class: "muted small" }, `${r.have} of ${r.total || "?"} cards · ${Math.round(r.pct * 100)}%`)))))
      : h("p", { class: "empty" }, "Add cards to your collection to track set progress. ", h("a", { href: "#/scan" }, "Scan a card")),
    h("h2", {}, "Browse any set"),
    h("div", { class: "sets compact" }, sets.slice().reverse().slice(0, 300).map((s) => h("a", { class: "chip", href: `#/sets/${encodeURIComponent(s.id)}` }, s.name)))));
}

async function renderSet(root, setId) {
  mount(root, h("section", { class: "panel" }, h("p", { class: "empty" }, "Loading set…")));
  let set;
  try { set = await getSet(setId); } catch (e) { mount(root, h("section", { class: "panel" }, h("p", { class: "error" }, e.message))); return; }
  if (!set) { mount(root, h("section", { class: "panel" }, h("p", { class: "error" }, "Set not found."), h("a", { href: "#/sets" }, "← Back to sets"))); return; }

  const owned = ownedIds();
  const official = set.official || set.cards.length;
  const have = set.cards.filter((c) => owned.has(c.id)).length;
  const missingOnly = h("input", { type: "checkbox", id: "missing-only" });
  const grid = h("div", { class: "grid" });

  const draw = () => {
    const cards = missingOnly.checked ? set.cards.filter((c) => !owned.has(c.id)) : set.cards;
    mount(grid, cards.map((c) => cardTile({ ...c, set: { id: set.id, name: set.name } }, { owned: owned.has(c.id) })));
  };
  missingOnly.addEventListener("change", draw);

  const wishMissing = () => {
    let n = 0;
    for (const c of set.cards) if (!owned.has(c.id) && addToWishlist({ ...c, set: { id: set.id, name: set.name } })) n++;
    toast(n ? `Added ${n} missing cards to your wishlist` : "Nothing new to add");
  };

  mount(root, h("section", { class: "panel" },
    h("a", { href: "#/sets", class: "small" }, "← All sets"),
    h("div", { class: "head" },
      h("div", {}, set.logo ? cardImgLogo(set.logo, set.name) : null, h("h1", {}, set.name),
        h("p", { class: "muted" }, `${have} of ${official} owned${set.releaseDate ? ` · released ${set.releaseDate}` : ""}`), progress(Math.min(1, have / (official || 1)))),
      h("div", { class: "row" },
        h("label", { for: "missing-only", class: "check" }, missingOnly, " Missing only"),
        h("button", { class: "btn", type: "button", onclick: wishMissing }, "Wishlist all missing"))),
    grid));
  draw();
}

function progress(pct) {
  const fill = h("span", { class: "fill" });
  // CSSOM writes are allowed under the page CSP (inline style attributes are not).
  fill.style.width = `${Math.round(pct * 100)}%`;
  return h("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(pct * 100)) }, fill);
}

function cardImgLogo(base, name) {
  const el = cardImg(base, `${name} logo`);
  if (el.tagName === "IMG") { el.src = `${base}.webp`; el.className = "set-banner"; }
  return el;
}
