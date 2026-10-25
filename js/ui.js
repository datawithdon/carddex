// Shared UI pieces: card tiles, the card detail sheet (prices + add forms) and the modal host.

import { getCard } from "./api.js";
import { $, cardImg, h, money, mount, toast } from "./dom.js";
import { pickPrice, priceVariants } from "./match.js";
import { CONDITIONS, CONDITION_LABELS, addToCollection, addToWishlist, ownedIds, state } from "./store.js";

export function priceTag(price) {
  return price ? h("span", { class: "price" }, money(price.value, price.currency)) : h("span", { class: "price muted" }, "No price");
}

/** Grid tile for a full or brief card. `onOpen` opens the detail sheet. */
export function cardTile(card, { owned = false, extra = null, score = null } = {}) {
  const price = card.pricing ? pickPrice(card.pricing, state.settings.priceSource) : null;
  return h("button", { class: `tile${owned ? " owned" : ""}`, type: "button", onclick: () => openCard(card.id) },
    cardImg(card.image, card.name),
    h("span", { class: "tile-name" }, card.name),
    h("span", { class: "tile-meta" }, [card.set?.name, card.localId && `#${card.localId}`].filter(Boolean).join(" · ")),
    card.pricing ? priceTag(price) : null,
    score != null ? h("span", { class: `match ${score >= 0.75 ? "good" : score >= 0.5 ? "warn" : "bad"}` }, `${Math.round(score * 100)}% match`) : null,
    owned ? h("span", { class: "badge good" }, "Owned") : null,
    extra,
  );
}

// ----------------------------------------------------------------- modal

let lastFocus = null;
export function openModal(...content) {
  const host = $("#modal");
  lastFocus = document.activeElement;
  mount(host, h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Card details" },
    h("button", { class: "icon-btn close", type: "button", "aria-label": "Close", onclick: closeModal }, "×"),
    ...content));
  host.classList.remove("hidden");
  document.body.classList.add("modal-open");
  host.querySelector(".close").focus();
}

export function closeModal() {
  const host = $("#modal");
  host.classList.add("hidden");
  host.replaceChildren();
  document.body.classList.remove("modal-open");
  lastFocus?.focus?.();
}

/** Open the detail sheet for a card id (fetches full data with prices). */
export async function openCard(id, after = () => {}) {
  openModal(h("p", { class: "empty" }, "Loading card…"));
  let card;
  try { card = await getCard(id); } catch (e) { openModal(h("p", { class: "error" }, e.message)); return; }
  if (!card) { openModal(h("p", { class: "error" }, "Card not found.")); return; }
  openModal(cardSheet(card, after));
}

export function cardSheet(card, after = () => {}) {
  const variants = card.pricing ? priceVariants(card.pricing) : [];
  const preferred = pickPrice(card.pricing, state.settings.priceSource);
  const owned = state.collection.filter((i) => i.cardId === card.id).reduce((n, i) => n + i.qty, 0);
  const wished = state.wishlist.some((w) => w.cardId === card.id);

  const qty = h("input", { type: "number", min: "1", max: "9999", value: "1", inputmode: "numeric", "aria-label": "Quantity" });
  const cond = h("select", { "aria-label": "Condition" }, CONDITIONS.map((c) => h("option", { value: c }, `${c} — ${CONDITION_LABELS[c]}`)));
  const variant = h("select", { "aria-label": "Variant" },
    variants.length ? variants.map((v) => h("option", { value: v.key, selected: v.key === preferred?.key }, `${v.label} (${money(v.value, v.currency)})`)) : h("option", { value: "" }, "No price data"));
  const paid = h("input", { type: "number", min: "0", step: "0.01", placeholder: "optional", "aria-label": "Price paid" });
  const target = h("input", { type: "number", min: "0", step: "0.01", placeholder: preferred ? preferred.value.toFixed(2) : "", "aria-label": "Target price" });

  const tcgLink = variants.find((v) => v.productId);
  return h("div", { class: "card-detail" },
    h("div", { class: "detail-img" }, cardImg(card.image, card.name, "high")),
    h("div", { class: "detail-body" },
      h("h2", {}, card.name),
      h("p", { class: "muted" }, [card.set?.name, card.localId && `#${card.localId}${card.set?.official ? `/${card.set.official}` : ""}`, card.rarity].filter(Boolean).join(" · ")),
      h("p", { class: "muted small" }, [card.category, card.stage, card.hp && `${card.hp} HP`, card.types.join("/"), card.illustrator && `Illus. ${card.illustrator}`].filter(Boolean).join(" · ")),
      owned ? h("p", {}, h("span", { class: "badge good" }, `You own ${owned}`)) : null,
      h("h3", {}, "Market prices"),
      variants.length
        ? h("table", { class: "prices" },
          h("thead", {}, h("tr", {}, h("th", {}, "Variant"), h("th", {}, "Market"), h("th", {}, "Low"), h("th", {}, "High"))),
          h("tbody", {}, variants.map((v) => h("tr", {},
            h("td", {}, v.label), h("td", {}, money(v.value, v.currency)), h("td", {}, money(v.low, v.currency)), h("td", {}, money(v.high, v.currency))))))
        : h("p", { class: "muted" }, "No price data for this card."),
      tcgLink ? h("p", { class: "small" }, h("a", { href: `https://www.tcgplayer.com/product/${tcgLink.productId}`, target: "_blank", rel: "noopener noreferrer" }, "View on TCGplayer ↗")) : null,
      h("h3", {}, "Add to collection"),
      h("div", { class: "form-grid" },
        h("label", {}, "Qty", qty), h("label", {}, "Condition", cond), h("label", {}, "Variant", variant), h("label", {}, "Paid", paid)),
      h("button", { class: "btn primary", type: "button", onclick: () => {
        const p = variants.find((v) => v.key === variant.value) || null;
        const q = Math.max(1, Math.min(9999, Math.floor(Number(qty.value) || 1)));
        const pd = paid.value === "" ? null : Math.max(0, Number(paid.value));
        addToCollection(card, { qty: q, condition: cond.value, price: p, paid: Number.isFinite(pd) ? pd : null });
        toast(`Added ${q} × ${card.name}`);
        closeModal();
        after("added");
      } }, "Add to collection"),
      h("h3", {}, "Wishlist"),
      wished
        ? h("p", { class: "muted" }, "Already on your wishlist.")
        : h("div", { class: "row" },
          h("label", {}, "Alert me at or below", target),
          h("button", { class: "btn", type: "button", onclick: () => {
            const t = target.value === "" ? null : Number(target.value);
            addToWishlist(card, { target: Number.isFinite(t) && t >= 0 ? t : null, price: preferred });
            toast(`${card.name} added to wishlist`);
            closeModal();
            after("wished");
          } }, "Add to wishlist")),
    ));
}

export const isOwned = () => { const s = ownedIds(); return (id) => s.has(id); };
