// App state: collection, wishlist and settings, persisted in localStorage.
// Everything read back from storage or from an imported backup goes through
// sanitize(), which rebuilds each record from known fields with type and length
// checks — so a tampered backup can't smuggle odd values into the app.

export const STORAGE_KEY = "carddex.v1";
const MAX_ITEMS = 20000;

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
export const CONDITION_LABELS = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged" };
export const MODELS = {
  "claude-opus-5-5": "Claude Opus 5.5 (most accurate)",
  "claude-sonnet-5-5": "Claude Sonnet 5.5 (faster, cheaper)",
  "claude-haiku-5-5": "Claude Haiku 5.5 (cheapest)",
};
export const DEFAULT_MODEL = "claude-opus-5-5";

export const DEFAULT_SETTINGS = { priceSource: "tcgplayer", model: DEFAULT_MODEL, autoAi: false, keepCamera: true, notify: false };

const str = (v, max = 120) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const num = (v, min = 0, max = 1e7) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);
const int = (v, min, max, dflt) => (Number.isInteger(v) && v >= min && v <= max ? v : dflt);
const date = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

export const CARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.!_-]{0,40}$/;
export const IMAGE_RE = /^https:\/\/assets\.tcgdex\.net\/[A-Za-z0-9/._-]{1,150}$/;
const VARIANT_RE = /^(tcgplayer|cardmarket):[A-Za-z0-9-]{1,40}$/;

const cardId = (v) => (typeof v === "string" && CARD_ID_RE.test(v) ? v : null);
const image = (v) => (typeof v === "string" && IMAGE_RE.test(v) ? v : "");
const currency = (v) => (v === "EUR" ? "EUR" : "USD");

let seq = 0;
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function cleanBase(x) {
  const id = cardId(x?.cardId);
  if (!id) return null;
  return {
    cardId: id,
    name: str(x.name, 80) || id,
    setId: str(x.setId, 40),
    setName: str(x.setName, 80),
    number: str(x.number, 12),
    rarity: str(x.rarity, 40),
    image: image(x.image),
    price: num(x.price),
    currency: currency(x.currency),
    priceUpdated: date(x.priceUpdated),
  };
}

export function cleanItem(x) {
  const base = cleanBase(x);
  if (!base) return null;
  return {
    id: typeof x.id === "string" && /^[a-z0-9]{4,40}$/.test(x.id) ? x.id : newId(),
    ...base,
    qty: int(x.qty, 1, 9999, 1),
    condition: CONDITIONS.includes(x.condition) ? x.condition : "NM",
    variant: typeof x.variant === "string" && VARIANT_RE.test(x.variant) ? x.variant : "",
    paid: num(x.paid),
    notes: str(x.notes, 300),
    addedAt: date(x.addedAt) || new Date().toISOString(),
  };
}

export function cleanWish(x) {
  const base = cleanBase(x);
  if (!base) return null;
  return {
    ...base,
    target: num(x.target),
    lowestSeen: num(x.lowestSeen),
    alerted: x.alerted === true,
    addedAt: date(x.addedAt) || new Date().toISOString(),
  };
}

export function cleanSettings(x) {
  const s = x && typeof x === "object" ? x : {};
  return {
    priceSource: s.priceSource === "cardmarket" ? "cardmarket" : "tcgplayer",
    model: Object.hasOwn(MODELS, s.model) ? s.model : DEFAULT_MODEL,
    autoAi: s.autoAi === true,
    keepCamera: s.keepCamera !== false,
    notify: s.notify === true,
  };
}

/** Rebuild a whole state object from untrusted input. */
export function sanitize(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const collection = (Array.isArray(r.collection) ? r.collection : []).slice(0, MAX_ITEMS).map(cleanItem).filter(Boolean);
  const wishSeen = new Set();
  const wishlist = (Array.isArray(r.wishlist) ? r.wishlist : []).slice(0, MAX_ITEMS).map(cleanWish)
    .filter((w) => w && !wishSeen.has(w.cardId) && wishSeen.add(w.cardId));
  return { version: 1, collection, wishlist, settings: cleanSettings(r.settings), lastPriceCheck: date(r.lastPriceCheck) };
}

// ------------------------------------------------------------- persistence

export const state = sanitize(null);
const listeners = new Set();

export function load(storage = globalThis.localStorage) {
  let raw = null;
  try { raw = JSON.parse(storage?.getItem(STORAGE_KEY) || "null"); } catch { raw = null; }
  Object.assign(state, sanitize(raw));
}

export function save(storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  } finally {
    for (const fn of listeners) fn();
  }
}

export const onChange = (fn) => listeners.add(fn);

export function replaceAll(raw) {
  Object.assign(state, sanitize(raw));
  return save();
}

// ------------------------------------------------------------- collection

/** Snapshot of a card's display fields, as stored in the collection / wishlist. */
export function snapshot(card, price) {
  return {
    cardId: card.id,
    name: card.name,
    setId: card.set?.id || "",
    setName: card.set?.name || "",
    number: card.localId || "",
    rarity: card.rarity || "",
    image: card.image || "",
    price: price ? price.value : null,
    currency: price ? price.currency : "USD",
    priceUpdated: price ? new Date().toISOString() : null,
  };
}

export function addToCollection(card, { qty = 1, condition = "NM", price = null, paid = null } = {}) {
  const variant = price?.key || "";
  const existing = state.collection.find((i) => i.cardId === card.id && i.condition === condition && i.variant === variant);
  if (existing) {
    existing.qty = Math.min(9999, existing.qty + qty);
    if (price) Object.assign(existing, { price: price.value, currency: price.currency, priceUpdated: new Date().toISOString() });
  } else {
    const item = cleanItem({ ...snapshot(card, price), qty, condition, variant, paid, addedAt: new Date().toISOString() });
    if (item) state.collection.unshift(item);
  }
  save();
}

export function addToWishlist(card, { target = null, price = null } = {}) {
  if (state.wishlist.some((w) => w.cardId === card.id)) return false;
  const w = cleanWish({ ...snapshot(card, price), target, lowestSeen: price?.value ?? null, addedAt: new Date().toISOString() });
  if (!w) return false;
  state.wishlist.unshift(w);
  save();
  return true;
}

export const ownedIds = () => new Set(state.collection.map((i) => i.cardId));

/** Totals per currency, since TCGplayer is USD and Cardmarket is EUR. */
export function collectionValue(items = state.collection) {
  const totals = { USD: 0, EUR: 0 };
  let priced = 0, cards = 0;
  for (const i of items) {
    cards += i.qty;
    if (i.price != null) { totals[i.currency] += i.price * i.qty; priced += i.qty; }
  }
  return { totals, cards, priced, unique: new Set(items.map((i) => i.cardId)).size };
}

/** A wishlist entry is a deal when its price is at or under the target. */
export const isDeal = (w) => w.target != null && w.price != null && w.price <= w.target;

// ------------------------------------------------------------- API key

const KEY_NAME = "carddex.apiKey";
// Kept in sessionStorage (cleared when the tab closes) unless the user opts
// to remember it on this device. It is never written into backups.
export function getApiKey() {
  try { return sessionStorage.getItem(KEY_NAME) || localStorage.getItem(KEY_NAME) || ""; } catch { return ""; }
}
export function setApiKey(key, remember) {
  try {
    sessionStorage.removeItem(KEY_NAME);
    localStorage.removeItem(KEY_NAME);
    if (!key) return;
    (remember ? localStorage : sessionStorage).setItem(KEY_NAME, key);
  } catch { /* storage blocked: key is not kept */ }
}
export function keyRemembered() {
  try { return Boolean(localStorage.getItem(KEY_NAME)); } catch { return false; }
}
