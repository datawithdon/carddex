// Refresh stored prices for collection items and wishlist entries, and raise
// price-drop alerts for wishlist cards that fall to or below their target.

import { clearMemo, getCard, pool } from "./api.js";
import { pickPrice } from "./match.js";
import { isDeal, save, state } from "./store.js";

const AUTO_CHECK_MS = 6 * 3600 * 1000;

/** Fetch current prices for every distinct card in the collection and wishlist. */
export async function refreshPrices(onProgress = () => {}) {
  clearMemo();
  const ids = [...new Set([...state.collection.map((i) => i.cardId), ...state.wishlist.map((w) => w.cardId)])];
  let done = 0;
  const cards = await pool(ids, 4, async (id) => {
    const c = await getCard(id);
    onProgress(++done, ids.length);
    return c;
  });
  const byId = new Map(cards.filter(Boolean).map((c) => [c.id, c]));
  const now = new Date().toISOString();

  for (const item of state.collection) {
    const c = byId.get(item.cardId);
    if (!c) continue;
    const p = pickPrice(c.pricing, state.settings.priceSource, item.variant || null);
    if (p) Object.assign(item, { price: p.value, currency: p.currency, priceUpdated: now });
  }

  const newDeals = [];
  for (const w of state.wishlist) {
    const c = byId.get(w.cardId);
    if (!c) continue;
    const p = pickPrice(c.pricing, state.settings.priceSource);
    if (!p) continue;
    const wasDeal = isDeal(w);
    Object.assign(w, { price: p.value, currency: p.currency, priceUpdated: now });
    if (w.lowestSeen == null || p.value < w.lowestSeen) w.lowestSeen = p.value;
    if (isDeal(w) && (!wasDeal || !w.alerted)) { newDeals.push(w); w.alerted = true; }
    if (!isDeal(w)) w.alerted = false;
  }
  state.lastPriceCheck = now;
  save();
  if (newDeals.length) notify(newDeals);
  return { updated: byId.size, failed: ids.length - byId.size, newDeals };
}

/** On start-up, re-check wishlist prices if the last check was over 6 hours ago. */
export async function autoCheck() {
  if (!state.wishlist.length) return null;
  const last = state.lastPriceCheck ? Date.parse(state.lastPriceCheck) : 0;
  if (Date.now() - last < AUTO_CHECK_MS) return null;
  try { return await refreshPrices(); } catch { return null; }
}

function notify(deals) {
  if (!state.settings.notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const body = deals.slice(0, 3).map((d) => `${d.name}: ${d.currency === "EUR" ? "€" : "$"}${d.price.toFixed(2)}`).join("\n");
  try { new Notification(deals.length === 1 ? "Wishlist price drop" : `${deals.length} wishlist price drops`, { body, icon: "icons/icon.svg", tag: "carddex-deals" }); } catch { /* not allowed here */ }
}
