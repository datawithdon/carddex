import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, nameScore, nameTokens, parseHp, parseNumbers, stripOtherNames, pickPrice, priceVariants, rankCandidates, toCsv } from "../js/match.js";

test("parseNumbers reads common collector-number formats", () => {
  assert.deepEqual(parseNumbers("Illus. Mitsuhiro Arita  4/102 ★").map((n) => [n.number, n.total]), [["4", 102]]);
  assert.deepEqual(parseNumbers("G  006/165  ★★").map((n) => [n.number, n.total]), [["006", 165]]);
  assert.deepEqual(parseNumbers("SV 025 / 198").map((n) => [n.number, n.total]), [["025", 198]]);
  assert.deepEqual(parseNumbers("TG05/TG30").map((n) => [n.number, n.total]), [["TG05", 30]]);
});

test("parseNumbers fixes OCR letter/digit confusion", () => {
  assert.deepEqual(parseNumbers("O25/l98").map((n) => [n.number, n.total]), [["025", 198]]);
  assert.deepEqual(parseNumbers("4/1O2").map((n) => [n.number, n.total]), [["4", 102]]);
});

test("parseNumbers puts secret rares last and ignores junk", () => {
  const r = parseNumbers("199/165 and 12/165");
  assert.equal(r[0].number, "12");
  assert.equal(r[1].secret, true);
  assert.deepEqual(parseNumbers("weakness x2 1/2 retreat"), []);
  assert.deepEqual(parseNumbers(""), []);
  assert.deepEqual(parseNumbers(null), []);
});

test("nameTokens drops card boilerplate and keeps the name first", () => {
  const t = nameTokens("STAGE 2 Evolves from Charmeleon\nCharizard ex  HP 330");
  assert.ok(t.includes("Charizard"));
  assert.ok(!t.map((x) => x.toLowerCase()).includes("stage"));
  assert.ok(!t.map((x) => x.toLowerCase()).includes("evolves"));
});

test("nameScore tolerates OCR typos and stray words", () => {
  assert.equal(nameScore("Charizard", "BASIC Charizard HP 120"), 1);
  assert.ok(nameScore("Charizard", "Charlzard") > 0.85);
  assert.ok(nameScore("Pikachu", "Charizard") < 0.4);
  assert.equal(nameScore("", "x"), 0);
});

test("rankCandidates prefers name + number + set total", () => {
  const read = { nameText: "Charizard", number: "4", total: 102 };
  const cards = [
    { id: "base4-4", name: "Charizard", localId: "4", set: { official: 130 } },
    { id: "base1-4", name: "Charizard", localId: "4", set: { official: 102 } },
    { id: "base1-3", name: "Chansey", localId: "3", set: { official: 102 } },
  ];
  const r = rankCandidates(cards, read);
  assert.equal(r[0].id, "base1-4");
  assert.ok(r[0].score > r[1].score);
  assert.equal(r.at(-1).id, "base1-3");
});

test("rankCandidates de-duplicates by id", () => {
  const c = { id: "x-1", name: "Mew", localId: "1", set: { official: 10 } };
  assert.equal(rankCandidates([c, { ...c }], { nameText: "Mew", number: "1", total: 10 }).length, 1);
});

const PRICING = {
  cardmarket: { unit: "EUR", avg: 8.27, low: 2.99, trend: 7.66, "trend-holo": 0, "avg-holo": null },
  tcgplayer: {
    unit: "USD", updated: "2026-10-14",
    normal: { lowPrice: 0.05, midPrice: 0.2, highPrice: 3, marketPrice: 0.12, productId: 1 },
    "reverse-holofoil": { lowPrice: 0.2, midPrice: 0.5, highPrice: 4, marketPrice: 0.4, productId: 1 },
    holofoil: { lowPrice: 5.75, midPrice: 9, highPrice: 229.02, marketPrice: 7.83, productId: 502558 },
  },
};

test("priceVariants lists TCGplayer variants (holo first) and Cardmarket", () => {
  const v = priceVariants(PRICING);
  assert.deepEqual(v.map((x) => x.key), ["tcgplayer:holofoil", "tcgplayer:normal", "tcgplayer:reverse-holofoil", "cardmarket:normal"]);
  assert.equal(v[0].value, 7.83);
  assert.equal(v[0].productId, 502558);
  assert.equal(v.at(-1).currency, "EUR");
});

test("priceVariants ignores bad numbers and missing data", () => {
  assert.deepEqual(priceVariants(null), []);
  assert.deepEqual(priceVariants({ tcgplayer: { normal: { marketPrice: "9" } } }), []);
  assert.deepEqual(priceVariants({ tcgplayer: { normal: { marketPrice: -1, midPrice: Infinity } } }), []);
});

test("pickPrice honours source and chosen variant", () => {
  assert.equal(pickPrice(PRICING, "tcgplayer").key, "tcgplayer:holofoil");
  assert.equal(pickPrice(PRICING, "cardmarket").value, 7.66);
  assert.equal(pickPrice(PRICING, "tcgplayer", "tcgplayer:normal").value, 0.12);
  assert.equal(pickPrice(PRICING, "tcgplayer", "tcgplayer:nope").key, "tcgplayer:holofoil");
  assert.equal(pickPrice(null), null);
});

test("csvCell neutralises formulas and quotes", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("@SUM"), "'@SUM");
  assert.equal(csvCell("a,b"), "\"a,b\"");
  assert.equal(csvCell(null), "");
  assert.equal(toCsv([["a", 1], ["b", 2]]), "a,1\r\nb,2\r\n");
});

test("parseHp keeps plausible HP values only", () => {
  assert.deepEqual(parseHp("Charizard HP 330 W"), [330]);
  assert.deepEqual(parseHp("120 HP"), [120]);
  assert.deepEqual(parseHp("HP 125 1999"), []);
  assert.deepEqual(parseHp("W.1800®"), [180]);
  assert.deepEqual(parseHp("330%"), [330]);
  assert.deepEqual(parseHp(null), []);
});

test("nameScore matches names OCR glued together", () => {
  assert.equal(nameScore("Celebi V", "=cfCelebiV\""), 1);
});

test("HP breaks a tie between same-number cards", () => {
  const cards = [
    { id: "ecard1-6", name: "Charizard", localId: "6", hp: 100, set: { official: 165 } },
    { id: "sv03.5-006", name: "Charizard ex", localId: "006", hp: 330, set: { official: 165 } },
  ];
  assert.equal(rankCandidates(cards, { nameText: "555 Charizard (GX A", number: "006", total: 165, hp: [330] })[0].id, "sv03.5-006");
});

test("stripOtherNames removes evolves-from and put-on phrases", () => {
  const t = "STAGE 2 Evolves from Charmeleon Put Charizard on the Stage 1 card\nChavirard 120 HP";
  assert.ok(!/Charmeleon/.test(stripOtherNames(t)));
  assert.ok(nameScore("Charizard", stripOtherNames(t)) > nameScore("Charmeleon", stripOtherNames(t)));
  const r = rankCandidates([
    { id: "sm75-2", name: "Charmeleon", localId: "2", set: { official: 70 } },
    { id: "base1-4", name: "Charizard", localId: "4", set: { official: 102 } },
  ], { nameText: t });
  assert.equal(r[0].id, "base1-4");
});

test("a clean read with suffix and set name picks the right same-number card", () => {
  const cards = [
    { id: "ecard1-6", name: "Charizard", localId: "6", hp: 100, set: { official: 165, name: "Expedition Base Set" } },
    { id: "sv03.5-006", name: "Charizard ex", localId: "006", hp: 330, set: { official: 165, name: "151" } },
  ];
  const r = rankCandidates(cards, { nameText: "Charizard ex", number: "006", total: 165, setName: "151" });
  assert.equal(r[0].id, "sv03.5-006");
  assert.ok(r[0].raw - r[1].raw >= 0.08);
  assert.ok(nameScore("Charizard", "Charizard ex") < nameScore("Charizard ex", "Charizard ex"));
});
