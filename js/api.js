// TCGdex client (https://tcgdex.dev, free, no key). Every response is treated
// as untrusted: cards are rebuilt by cleanCard() with type and length checks
// before the UI sees them, and IDs are validated before going into a URL path.

import { CARD_ID_RE, IMAGE_RE } from "./store.js";

const BASE = "https://api.tcgdex.net/v2/en";
const TIMEOUT_MS = 15000;
const SETS_CACHE_KEY = "carddex.sets";
const SETS_TTL_MS = 24 * 3600 * 1000;

const memo = new Map();

async function getJson(path, { allow404 = false } = {}) {
  if (memo.has(path)) return memo.get(path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(BASE + path, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer", headers: { accept: "application/json" } });
  } catch {
    throw new Error("Could not reach the card database. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
  if (allow404 && res.status === 404) return null;
  if (!res.ok) throw new Error(`Card database error ${res.status}.`);
  let data;
  try { data = await res.json(); } catch { throw new Error("The card database sent an unreadable reply."); }
  memo.set(path, data);
  if (memo.size > 400) memo.delete(memo.keys().next().value);
  return data;
}

const str = (v, max = 120) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const img = (v) => (typeof v === "string" && IMAGE_RE.test(v) ? v : "");
const seg = (v) => encodeURIComponent(String(v));

function cleanSetRef(s) {
  if (!s || typeof s !== "object") return null;
  return { id: str(s.id, 40), name: str(s.name, 80), official: n(s.cardCount?.official), total: n(s.cardCount?.total), logo: img(s.logo), symbol: img(s.symbol) };
}

/** A full card from /cards/{id}. Pricing stays as the raw object; match.js reads it defensively. */
export function cleanCard(c) {
  if (!c || typeof c !== "object" || typeof c.id !== "string" || !CARD_ID_RE.test(c.id)) return null;
  return {
    id: c.id,
    localId: str(c.localId, 12),
    name: str(c.name, 80) || c.id,
    image: img(c.image),
    rarity: str(c.rarity, 40),
    category: str(c.category, 20),
    hp: n(c.hp),
    types: Array.isArray(c.types) ? c.types.slice(0, 4).map((t) => str(t, 20)) : [],
    stage: str(c.stage, 20),
    illustrator: str(c.illustrator, 60),
    set: cleanSetRef(c.set),
    pricing: c.pricing && typeof c.pricing === "object" ? c.pricing : null,
    brief: false,
  };
}

/** A brief card from list endpoints: id, localId, name, image only. */
function cleanBrief(c) {
  if (!c || typeof c !== "object" || typeof c.id !== "string" || !CARD_ID_RE.test(c.id)) return null;
  return { id: c.id, localId: str(c.localId, 12), name: str(c.name, 80) || c.id, image: img(c.image), brief: true };
}

export async function getCard(id) {
  if (!CARD_ID_RE.test(id)) return null;
  return cleanCard(await getJson(`/cards/${seg(id)}`, { allow404: true }));
}

/** Card by set + printed number; tries the number as printed, then without leading zeros. */
export async function getSetCard(setId, number) {
  const tries = [...new Set([number, String(number).replace(/^0+(?=\d)/, "")])];
  for (const t of tries) {
    if (!/^[A-Za-z0-9]{1,8}$/.test(t)) continue;
    const c = await getJson(`/sets/${seg(setId)}/${seg(t)}`, { allow404: true });
    if (c) return cleanCard(c);
  }
  return null;
}

/** Search cards. Name matching is TCGdex's "contains" filter. */
export async function searchCards({ name = "", setId = "", type = "", rarity = "", page = 1, perPage = 30 } = {}) {
  const q = new URLSearchParams();
  if (name) q.set("name", name.slice(0, 60));
  if (setId) q.set("set.id", setId.slice(0, 40));
  if (type) q.set("types", type.slice(0, 20));
  if (rarity) q.set("rarity", rarity.slice(0, 40));
  q.set("pagination:page", String(page));
  q.set("pagination:itemsPerPage", String(perPage));
  const data = await getJson(`/cards?${q}`);
  return (Array.isArray(data) ? data : []).map(cleanBrief).filter(Boolean);
}

/** Sets list, cached for a day. Excludes TCG Pocket (digital-only) sets. */
export async function getSets() {
  try {
    const cached = JSON.parse(localStorage.getItem(SETS_CACHE_KEY) || "null");
    if (cached && Date.now() - cached.at < SETS_TTL_MS && Array.isArray(cached.sets)) return cached.sets.map(cleanSetRef).filter((s) => s && s.id);
  } catch { /* fall through to network */ }
  const [list, pocket] = await Promise.all([getJson("/sets"), getJson("/series/tcgp", { allow404: true }).catch(() => null)]);
  const digital = new Set((pocket?.sets || []).map((s) => s.id));
  // /sets nests the counts under cardCount, like a card's set ref.
  const sets = (Array.isArray(list) ? list : []).filter((s) => !digital.has(s.id)).map(cleanSetRef).filter((s) => s && s.id);
  try {
    localStorage.setItem(SETS_CACHE_KEY, JSON.stringify({ at: Date.now(), sets: sets.map((s) => ({ id: s.id, name: s.name, logo: s.logo, symbol: s.symbol, cardCount: { official: s.official, total: s.total } })) }));
  } catch { /* cache is optional */ }
  return sets;
}

/** One set with its full card list (brief cards). */
export async function getSet(id) {
  if (!/^[A-Za-z0-9.!_-]{1,40}$/.test(id)) return null;
  const s = await getJson(`/sets/${seg(id)}`, { allow404: true });
  if (!s) return null;
  return { ...cleanSetRef(s), releaseDate: str(s.releaseDate, 10), cards: (Array.isArray(s.cards) ? s.cards : []).map(cleanBrief).filter(Boolean) };
}

export async function getRarities() {
  const r = await getJson("/rarities");
  return (Array.isArray(r) ? r : []).map((x) => str(x, 40)).filter(Boolean);
}

export async function getTypes() {
  const r = await getJson("/types");
  return (Array.isArray(r) ? r : []).map((x) => str(x, 20)).filter(Boolean);
}

/** Run async work over items with limited concurrency. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); } catch { out[k] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

/** Forget cached responses, e.g. before a price refresh. */
export const clearMemo = () => memo.clear();
