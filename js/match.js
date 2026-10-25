// Pure matching logic: turn noisy OCR text into a card number and a name guess,
// score API candidates against it, and pick prices out of TCGdex's pricing block.
// No DOM or network here, so it is unit-tested in Node.

// OCR commonly confuses these with digits inside a number token.
const DIGITISH = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", i: "1", "|": "1", "!": "1", Z: "2", z: "2", S: "5", s: "5", B: "8", g: "9" };

const fixDigits = (s) => s.replace(/[OoDQIli|!ZzSsBg]/g, (c) => DIGITISH[c]);

// A leading letter run is a set prefix (TG, GG, SV, H) unless every letter is
// one OCR confuses with a digit — then "O25" is really "025".
function prefixOf(token) {
  const p = (token.match(/^[A-Z]{1,2}(?=[0-9OoDQIli|!ZzSsBg])/) || [""])[0];
  return [...p].every((c) => c in DIGITISH) ? "" : p;
}

/**
 * Find "number / printed total" pairs such as 4/102, 025/198, 6 / 165 or
 * TG05/TG30. Returns candidates, most plausible first.
 */
export function parseNumbers(text) {
  if (typeof text !== "string" || !text) return [];
  const out = [];
  const seen = new Set();
  // Allow a short letter prefix (TG, GG, SV, RC) on either side.
  const re = /(?:^|[^A-Za-z0-9])([A-Z]{0,2}[0-9OoDQIli|!ZzSsBg]{1,3})\s*[/\\]\s*([A-Z]{0,2}[0-9OoDQIli|!ZzSsBg]{2,3})(?![0-9])/g;
  for (const m of text.matchAll(re)) {
    const prefixA = prefixOf(m[1]);
    const prefixB = prefixOf(m[2]);
    const a = fixDigits(m[1].slice(prefixA.length));
    const b = fixDigits(m[2].slice(prefixB.length));
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) continue;
    const n = Number(a), t = Number(b);
    if (n < 1 || t < 10 || t > 400) continue;
    const key = `${prefixA}${a}/${prefixB}${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A card number above the printed total is legal (secret rares) but less likely.
    out.push({ number: prefixA + a, total: t, prefix: prefixA, secret: n > t, raw: m[0].trim() });
  }
  return out.sort((x, y) => Number(x.secret) - Number(y.secret));
}

// Words printed on cards that are never part of the Pokémon's name.
const STOP = new Set([
  "basic", "stage", "stage1", "stage2", "evolves", "from", "put", "this", "card", "on", "the", "hp", "weakness",
  "resistance", "retreat", "cost", "pokemon", "pokémon", "trainer", "item", "supporter", "energy", "tool", "stadium",
  "illus", "illustrator", "nintendo", "creatures", "game", "freak", "ability", "power", "length", "weight", "lbs", "no",
  "and", "your", "you", "may", "damage", "attack", "flip", "coin", "if", "heads", "tails", "opponent", "active", "bench",
]);

/**
 * Remove printed phrases that name a *different* Pokémon: "Evolves from Charmeleon",
 * "Put Charizard on the Stage 1 card". Otherwise they outvote the real name.
 */
export function stripOtherNames(text) {
  return String(text || "")
    .replace(/\b[a-z]{0,2}evo\w*\s+fro\w*\s+\S+(\s+ex)?/gi, " ")
    .replace(/\bput\s+\S+\s+on\s+the\b.*$/gim, " ");
}

/** Candidate name words from OCR text of the card's title strip, best first. */
export function nameTokens(text) {
  if (typeof text !== "string") return [];
  const words = stripOtherNames(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z'.-]+/)
    .map((w) => w.replace(/^[-'.]+|[-'.]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase()) && /[aeiouy]/i.test(w));
  const uniq = [...new Set(words)];
  // Capitalised words first (names are title case), then longer words.
  return uniq.sort((a, b) => Number(/^[A-Z]/.test(b)) - Number(/^[A-Z]/.test(a)) || b.length - a.length).slice(0, 6);
}

export const norm = (s) =>
  String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Mechanic suffixes are printed as stylised logos that OCR reads badly ("ex" → "(5X").
const SUFFIXES = new Set(["ex", "gx", "v", "vmax", "vstar", "lv", "break", "prime", "star", "tag", "team"]);

/**
 * How well a card name matches OCR text, 0..1. Each word of the card name is
 * compared with the closest OCR word, so stray text around the name is ignored.
 * Suffixes (ex, V, GX…) only cost a little when they can't be seen.
 */
export function nameScore(cardName, ocrText) {
  const all = norm(cardName).split(" ").filter(Boolean);
  const have = norm(ocrText).split(" ").filter(Boolean);
  if (!all.length || !have.length) return 0;
  const core = all.filter((w) => !SUFFIXES.has(w) && w.length >= 2);
  const suffix = all.filter((w) => SUFFIXES.has(w));
  // The read shows a suffix this card doesn't have ("Charizard ex" vs plain "Charizard").
  const extra = !suffix.length && have.some((w) => w.length >= 2 && SUFFIXES.has(w)) ? 0.9 : 1;
  // OCR often glues words ("CelebiV"): an exact run of the joined name is a full match.
  const joined = all.join("");
  if (joined.length >= 4 && have.join("").includes(joined)) return extra;
  const want = core.length ? core : all;
  const closest = (w) => {
    let best = 0;
    for (const o of have) {
      best = Math.max(best, 1 - levenshtein(w, o) / Math.max(w.length, o.length));
      if (best === 1) break;
    }
    return best;
  };
  let score = want.reduce((t, w) => t + closest(w), 0) / want.length;
  if (core.length && suffix.length && !suffix.every((w) => closest(w) >= 0.66)) score *= 0.97;
  return score * extra;
}

/** HP values printed on the card (multiples of 10 between 30 and 400). */
export function parseHp(text) {
  if (typeof text !== "string") return [];
  const out = new Set();
  // A 4-digit run is usually HP plus an energy symbol read as a digit ("1800" → 180).
  for (const m of text.matchAll(/(?:^|\D)(\d{2,4})(?!\d)/g)) {
    for (const v of m[1].length === 4 ? [Number(m[1].slice(0, 3))] : [Number(m[1])]) {
      if (v >= 30 && v <= 400 && v % 10 === 0) out.add(v);
    }
  }
  return [...out];
}

export const sameNumber = (a, b) => {
  const x = String(a || "").replace(/^0+(?=\d)/, "").toUpperCase();
  const y = String(b || "").replace(/^0+(?=\d)/, "").toUpperCase();
  return x !== "" && x === y;
};

/**
 * Score full cards against what was read. `read` = { nameText, number, total, hp: [], setName }.
 * Returns cards with a `score` (0..1), best first.
 */
export function rankCandidates(cards, read) {
  const hps = Array.isArray(read.hp) ? read.hp : [];
  const nameText = stripOtherNames(read.nameText);
  const scored = cards.map((c) => {
    const ns = nameText ? nameScore(c.name, nameText) : 0;
    const num = read.number && sameNumber(c.localId, read.number) ? 1 : 0;
    const tot = read.total && c.set && (c.set.official === read.total || c.set.total === read.total) ? 1 : 0;
    const hp = c.hp != null && hps.includes(c.hp) ? 1 : 0;
    const set = read.setName && c.set?.name && norm(read.setName) === norm(c.set.name) ? 1 : 0;
    const weightName = read.number ? 0.55 : 0.85;
    // A matching HP read is strong evidence; the raw score ranks, the capped one is shown.
    const raw = ns * weightName + num * 0.3 + tot * 0.15 + hp * 0.2 + set * 0.15;
    return { ...c, raw, score: Math.round(Math.min(1, raw) * 100) / 100 };
  });
  const uniq = new Map();
  for (const c of scored) if (!uniq.has(c.id) || uniq.get(c.id).raw < c.raw) uniq.set(c.id, c);
  return [...uniq.values()].sort((a, b) => b.raw - a.raw);
}

// ------------------------------------------------------------------ prices

const TCG_VARIANT_LABELS = {
  normal: "Normal",
  holofoil: "Holofoil",
  "reverse-holofoil": "Reverse holo",
  reverseHolofoil: "Reverse holo",
  "1stEditionHolofoil": "1st Ed. holo",
  "1stEditionNormal": "1st Edition",
  "1st-edition-holofoil": "1st Ed. holo",
  "1st-edition": "1st Edition",
  unlimitedHolofoil: "Unlimited holo",
  unlimited: "Unlimited",
  "unlimited-holofoil": "Unlimited holo",
  "1st-edition-normal": "1st Edition",
};
const VARIANT_ORDER = ["holofoil", "normal", "reverse-holofoil", "reverseHolofoil", "unlimited-holofoil", "unlimitedHolofoil", "unlimited", "1st-edition-holofoil", "1stEditionHolofoil", "1st-edition-normal", "1stEditionNormal", "1st-edition"];

const finite = (n) => (typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 1e7 ? n : null);

/**
 * All price points for a card, as [{ key, label, source, currency, value, low, high }].
 * `value` is the market price (TCGplayer) or trend price (Cardmarket).
 */
export function priceVariants(pricing) {
  const out = [];
  const tcg = pricing && typeof pricing.tcgplayer === "object" ? pricing.tcgplayer : null;
  if (tcg) {
    const keys = Object.keys(tcg).filter((k) => tcg[k] && typeof tcg[k] === "object");
    keys.sort((a, b) => rank(a) - rank(b));
    for (const k of keys) {
      const p = tcg[k];
      const value = finite(p.marketPrice) ?? finite(p.midPrice) ?? finite(p.lowPrice);
      if (value == null) continue;
      out.push({
        key: `tcgplayer:${k}`, source: "tcgplayer", currency: "USD", label: TCG_VARIANT_LABELS[k] || k.slice(0, 30),
        value, low: finite(p.lowPrice), high: finite(p.highPrice),
        productId: Number.isInteger(p.productId) && p.productId > 0 ? p.productId : null,
      });
    }
  }
  const cm = pricing && typeof pricing.cardmarket === "object" ? pricing.cardmarket : null;
  if (cm) {
    const normal = finite(cm.trend) ?? finite(cm.avg) ?? finite(cm.avg30);
    if (normal != null && normal > 0) out.push({ key: "cardmarket:normal", source: "cardmarket", currency: "EUR", label: "Cardmarket", value: normal, low: finite(cm.low), high: null });
    const holo = finite(cm["trend-holo"]) || finite(cm["avg-holo"]) || finite(cm["avg30-holo"]);
    if (holo) out.push({ key: "cardmarket:holo", source: "cardmarket", currency: "EUR", label: "Cardmarket holo", value: holo, low: finite(cm["low-holo"]), high: null });
  }
  return out;
}

function rank(k) {
  const i = VARIANT_ORDER.indexOf(k);
  return i === -1 ? 99 : i;
}

/** The single price to show for a card: the chosen variant, else the first from the preferred source. */
export function pickPrice(pricing, source = "tcgplayer", variantKey = null) {
  const all = priceVariants(pricing);
  if (variantKey) {
    const v = all.find((p) => p.key === variantKey);
    if (v) return v;
  }
  return all.find((p) => p.source === source) || all[0] || null;
}

// ------------------------------------------------------------------ CSV

/** Quote a CSV cell and neutralise spreadsheet formulas (=, +, -, @, tab, CR). */
export function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
