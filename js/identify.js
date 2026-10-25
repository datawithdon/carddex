// Turns what was read off a card (by OCR or Claude) into ranked TCGdex matches.
//   1. "4/102" → sets whose printed total is 102 → /sets/{set}/4 for each.
//   2. Name words → name search, kept when the number (if any) agrees.
// Both lists are merged and ranked by match.rankCandidates().

import { getCard, getSetCard, getSets, pool, searchCards } from "./api.js";
import { nameTokens, parseHp, parseNumbers, rankCandidates } from "./match.js";

const MAX_SET_LOOKUPS = 14;
const MAX_DETAIL = 8;

/**
 * `read` = { nameText, hpText?, numberText, setName? } from a reader.
 * Returns { read: {nameText, number, total, hp}, matches: [card + score] }.
 */
export async function identify(read, onStep = () => {}) {
  const nums = parseNumbers(`${read.numberText || ""}\n${read.fullText || ""}`);
  const best = nums[0] || null;
  const parsed = { nameText: read.nameText || "", number: best?.number || "", total: best?.total || null, hp: parseHp(read.hpText), setName: read.setName || "" };
  const found = [];

  if (nums.length) {
    onStep(`Looking up card ${best.raw}…`);
    const sets = await getSets();
    const jobs = [];
    for (const nr of nums.slice(0, 3)) {
      let matching = sets.filter((s) => s.official === nr.total || s.total === nr.total);
      if (parsed.setName) {
        const want = parsed.setName.toLowerCase();
        matching.sort((a, b) => Number(b.name.toLowerCase() === want) - Number(a.name.toLowerCase() === want));
      }
      for (const s of matching) jobs.push([s.id, nr.number]);
    }
    const cards = await pool(jobs.slice(0, MAX_SET_LOOKUPS), 4, ([setId, number]) => getSetCard(setId, number));
    found.push(...cards.filter(Boolean));
  }

  const tokens = nameTokens(parsed.nameText);
  const strongByNumber = rankCandidates(found, parsed).some((c) => c.score >= 0.8);
  if (tokens.length && !strongByNumber) {
    onStep(`Searching for “${tokens[0]}”…`);
    const lists = await pool(tokens.slice(0, 2), 2, (t) => searchCards({ name: t, perPage: 60 }));
    let briefs = lists.flat().filter(Boolean);
    if (parsed.number) {
      const want = parsed.number.replace(/^0+(?=\d)/, "");
      const sameNum = briefs.filter((b) => b.localId.replace(/^0+(?=\d)/, "") === want);
      if (sameNum.length) briefs = sameNum;
    }
    const prelim = rankCandidates(briefs, parsed).slice(0, MAX_DETAIL);
    const have = new Set(found.map((c) => c.id));
    const details = await pool(prelim.filter((b) => !have.has(b.id)), 4, (b) => getCard(b.id));
    found.push(...details.filter(Boolean));
  }

  return { read: parsed, matches: rankCandidates(found, parsed).slice(0, 8) };
}
